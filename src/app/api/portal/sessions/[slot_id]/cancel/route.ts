// POST /api/portal/sessions/[slot_id]/cancel
//
// State B path: within 24hr of the live call.
// Per the reschedule spec: kid keeps the slides + voiceover, the live
// call is forfeit, counter +1. If counter hits 3, auto_renew_enabled
// flips off and the parent is notified.
//
// Defensive 24hr re-check on the server — the modal routes based on
// the same boundary, but we never trust the client to enforce policy.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { cancelCalendlyEvent } from "@/lib/calendly/api";
import { brandedEmailHtml } from "@/lib/email/template";
import { resend, FROM_EMAIL } from "@/lib/email/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlotLookup = {
  id: string;
  curriculum_id: string;
  live_call_at: string | null;
  live_call_event_id: string | null;
  week_number: number;
};
type CurriculumLookup = { id: string; player_id: string };
type PlayerLookup = { id: string; first_name: string; family_id: string };
type ParentLookup = { family_id: string; first_name: string; email: string };
type SubLookup = {
  id: string;
  cycle_skips_used: number;
  cycle_cancels_used: number;
  cycle_lessons_delivered: number;
  cycle_timezone: string;
  auto_renew_enabled: boolean;
  stripe_subscription_id: string | null;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slot_id: string }> },
) {
  const { slot_id } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parentRow = await supabase
    .from("parents")
    .select("family_id, first_name, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;
  if (!parent) return NextResponse.json({ error: "not_a_parent" }, { status: 403 });

  const service = createServiceRoleClient();

  // Resolve slot + ownership chain (slot -> curriculum -> player -> family).
  const slotRow = await service
    .from("curriculum_slots")
    .select("id, curriculum_id, live_call_at, live_call_event_id, week_number")
    .eq("id", slot_id)
    .maybeSingle();
  const slot = slotRow.data as SlotLookup | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });
  if (!slot.live_call_at) {
    return NextResponse.json({ error: "slot_has_no_call" }, { status: 400 });
  }

  const curriculumRow = await service
    .from("curricula")
    .select("id, player_id")
    .eq("id", slot.curriculum_id)
    .maybeSingle();
  const curriculum = curriculumRow.data as CurriculumLookup | null;
  if (!curriculum) return NextResponse.json({ error: "curriculum_not_found" }, { status: 404 });

  const playerRow = await service
    .from("players")
    .select("id, first_name, family_id")
    .eq("id", curriculum.player_id)
    .maybeSingle();
  const player = playerRow.data as PlayerLookup | null;
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  if (player.family_id !== parent.family_id) {
    return NextResponse.json({ error: "wrong_family" }, { status: 403 });
  }

  const subRow = await service
    .from("subscriptions")
    .select(
      "id, cycle_skips_used, cycle_cancels_used, cycle_lessons_delivered, cycle_timezone, auto_renew_enabled, stripe_subscription_id",
    )
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subRow.data as SubLookup | null;
  if (!sub) return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });

  // 24hr boundary check (cycle_timezone irrelevant for a pure duration math).
  const liveCallAt = new Date(slot.live_call_at);
  const hoursUntilCall = (liveCallAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilCall >= 24) {
    return NextResponse.json(
      { error: "use_reschedule", hours_until_call: hoursUntilCall },
      { status: 400 },
    );
  }
  if (hoursUntilCall <= -2) {
    // Call already ended 2+ hours ago. Cancelling a past call doesn't make sense.
    return NextResponse.json({ error: "call_already_passed" }, { status: 400 });
  }

  // Cancel the Calendly event. Idempotent for sentinel ids.
  if (slot.live_call_event_id) {
    const calResult = await cancelCalendlyEvent(
      slot.live_call_event_id,
      "Parent cancelled the live call from the dashboard",
    );
    if (!calResult.ok) {
      console.error("[sessions/cancel] Calendly cancel failed", calResult);
      // Don't bail — local state is the source of truth. Slot still gets
      // sentinel-marked so the Sunday cron doesn't ship it again, and
      // Tim's calendar will show the orphan event until reconciled.
    }
  }

  const newSkipsUsed = sub.cycle_skips_used + 1;
  const triggeredAutoRenewOff = newSkipsUsed >= 3 && sub.auto_renew_enabled;
  const nowIso = new Date().toISOString();

  // Mark slot: kid keeps the materials (forfeit pattern, same as the
  // existing webhook forfeit path), so delivered_at advances. Sentinel
  // the event id so we never re-ship + retain audit trail.
  const slotUpd = await service
    .from("curriculum_slots")
    .update({
      live_call_event_id: slot.live_call_event_id
        ? `cancelled:${slot.live_call_event_id}`
        : "cancelled:unknown",
      delivered_at: nowIso,
    } as never)
    .eq("id", slot.id);
  if (slotUpd.error) {
    console.error("[sessions/cancel] slot update failed", slotUpd.error);
    return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
  }

  // Subscription: bump skips counter (and the legacy cycle_cancels_used
  // we still dual-write during the rollout), advance the lessons counter
  // (forfeit), maybe flip auto_renew_enabled.
  const subUpd = await service
    .from("subscriptions")
    .update({
      cycle_skips_used: newSkipsUsed,
      cycle_cancels_used: sub.cycle_cancels_used + 1,
      cycle_lessons_delivered: sub.cycle_lessons_delivered + 1,
      last_cancel_at: nowIso,
      auto_renew_enabled: triggeredAutoRenewOff ? false : sub.auto_renew_enabled,
    } as never)
    .eq("id", sub.id);
  if (subUpd.error) {
    console.error("[sessions/cancel] subscription update failed", subUpd.error);
    return NextResponse.json({ error: "sub_update_failed" }, { status: 500 });
  }

  // Audit. classification='forfeit' since this is the <24hr path.
  await service.from("cancellation_events").insert({
    subscription_id: sub.id,
    curriculum_slot_id: slot.id,
    initiated_via: "portal",
    hours_until_call: hoursUntilCall,
    classification: "forfeit",
    cycle_cancels_used_after: newSkipsUsed,
    triggered_pending_cancel: false,
    waiting_on: "SYSTEM",
  } as never);

  if (triggeredAutoRenewOff) {
    await sendAutoRenewOffEmail(parent.email, parent.first_name, player.first_name);
  }

  return NextResponse.json({
    ok: true,
    skips_used: newSkipsUsed,
    auto_renew_enabled: !triggeredAutoRenewOff,
  });
}

async function sendAutoRenewOffEmail(
  parentEmail: string,
  parentFirstName: string,
  kidFirstName: string,
): Promise<void> {
  const html = brandedEmailHtml({
    headline: "Auto renew is off for the next cycle",
    bodyHtml: `<p>Hi ${parentFirstName},</p>
<p>${kidFirstName} hit 3 skips this cycle, so auto renew is off for the next cycle. The current cycle still finishes through lesson 4 as planned. No surprise charges.</p>
<p>If you want to keep going after this cycle, sign back into your dashboard and book a new cycle. Your progress and history are saved.</p>
<p>Anything to share? Reply to Tim in your messages.</p>
<p>Peter<br/>(Tim's dad, who runs the back end of XPL Keyed)</p>`,
  });
  await resend.emails.send({
    from: `XPL Keyed <${FROM_EMAIL.replace(/^.*<|>$/g, "")}>`,
    to: parentEmail,
    subject: "Auto renew off for the next cycle",
    html,
  });
}
