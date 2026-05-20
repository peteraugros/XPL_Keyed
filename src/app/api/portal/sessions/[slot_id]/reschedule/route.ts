// POST /api/portal/sessions/[slot_id]/reschedule
//
// State A path: outside the 24hr window. Parent picked a new time in
// the Calendly embed. Frontend posts the new booking's URI + time here.
//
// We:
//   1. Cancel the OLD Calendly event
//   2. Update the slot to the new time + new event id
//   3. If delta from original > 168hr (7 days), increment cycle_skips_used
//   4. If skips hits 3, flip auto_renew_enabled=false and email parent
//
// The 7-day rule runs against slot.live_call_at (the ORIGINAL time of
// this slot). If the parent reschedules twice in the same cycle, the
// counter math anchors on the most-recently-stored live_call_at, which
// is consistent: each move is judged against where the slot was sitting
// at the time of the move.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { cancelCalendlyEvent } from "@/lib/calendly/api";
import { brandedEmailHtml } from "@/lib/email/template";
import { resend, FROM_EMAIL } from "@/lib/email/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    new_event_uri: z.string().url(),
    new_time_iso: z.string().datetime(),
  })
  .strict();

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
  cycle_timezone: string;
  auto_renew_enabled: boolean;
};

const SEVEN_DAYS_HOURS = 7 * 24;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slot_id: string }> },
) {
  const { slot_id } = await ctx.params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

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
      "id, cycle_skips_used, cycle_cancels_used, cycle_timezone, auto_renew_enabled",
    )
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subRow.data as SubLookup | null;
  if (!sub) return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });

  // Defensive 24hr re-check against the ORIGINAL slot time.
  const originalLiveCallAt = new Date(slot.live_call_at);
  const hoursUntilOriginal =
    (originalLiveCallAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilOriginal < 24) {
    return NextResponse.json(
      { error: "within_24hr_must_cancel" },
      { status: 400 },
    );
  }

  const newLiveCallAt = new Date(body.new_time_iso);
  const deltaHours =
    (newLiveCallAt.getTime() - originalLiveCallAt.getTime()) / (1000 * 60 * 60);

  // 7 day window: free if the new time is within 7 days of the original
  // (in either direction). Outside that = cadence pushed = consumes a skip.
  const isFreeMove = Math.abs(deltaHours) <= SEVEN_DAYS_HOURS;

  // Cancel old Calendly event. Idempotent for sentinels.
  if (slot.live_call_event_id) {
    const calResult = await cancelCalendlyEvent(
      slot.live_call_event_id,
      "Parent rescheduled the live call to a new time",
    );
    if (!calResult.ok) {
      console.error("[sessions/reschedule] Calendly cancel of old event failed", calResult);
      // Don't bail. The new event already exists in Calendly; the old
      // will sit as an orphan until Tim manually cancels. Better to land
      // the new time locally than block the reschedule.
    }
  }

  // Update slot to new time + new event.
  const slotUpd = await service
    .from("curriculum_slots")
    .update({
      live_call_at: newLiveCallAt.toISOString(),
      live_call_event_id: body.new_event_uri,
    } as never)
    .eq("id", slot.id);
  if (slotUpd.error) {
    console.error("[sessions/reschedule] slot update failed", slotUpd.error);
    return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
  }

  if (isFreeMove) {
    return NextResponse.json({
      ok: true,
      free: true,
      skips_used: sub.cycle_skips_used,
      auto_renew_enabled: sub.auto_renew_enabled,
    });
  }

  // Skip path.
  const newSkipsUsed = sub.cycle_skips_used + 1;
  const triggeredAutoRenewOff = newSkipsUsed >= 3 && sub.auto_renew_enabled;

  const subUpd = await service
    .from("subscriptions")
    .update({
      cycle_skips_used: newSkipsUsed,
      cycle_cancels_used: sub.cycle_cancels_used + 1,
      last_cancel_at: new Date().toISOString(),
      auto_renew_enabled: triggeredAutoRenewOff ? false : sub.auto_renew_enabled,
    } as never)
    .eq("id", sub.id);
  if (subUpd.error) {
    console.error("[sessions/reschedule] subscription update failed", subUpd.error);
    return NextResponse.json({ error: "sub_update_failed" }, { status: 500 });
  }

  // Audit. classification='credit' because the live call is preserved
  // (just at a new time). Stays consistent with the existing webhook
  // classification taxonomy.
  await service.from("cancellation_events").insert({
    subscription_id: sub.id,
    curriculum_slot_id: slot.id,
    initiated_via: "portal",
    hours_until_call: hoursUntilOriginal,
    classification: "credit",
    cycle_cancels_used_after: newSkipsUsed,
    triggered_pending_cancel: false,
    waiting_on: "SYSTEM",
  } as never);

  if (triggeredAutoRenewOff) {
    await sendAutoRenewOffEmail(parent.email, parent.first_name, player.first_name);
  }

  return NextResponse.json({
    ok: true,
    free: false,
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
