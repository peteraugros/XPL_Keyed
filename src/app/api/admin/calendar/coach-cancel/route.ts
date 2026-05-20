// POST /api/admin/calendar/coach-cancel
//
// Tim's proactive cancel from /admin/calendar event modal. Three side
// effects, all in order:
//   1. coach_cancels row (audit + family-cycle pause; no skip charged
//      per CLAUDE.md "Coach cancellations")
//   2. Calendly event cancelled via REST (best-effort; we still local-
//      sentinel the slot so a webhook race no-ops cleanly)
//   3. curriculum_slots.delivered_at stamped so the Sunday cron skips
//      the week + live_call_event_id sentinel-marked
//   4. Parent email in Tim's voice
//   5. Auto-chat message to the kid (sender_role='coach', templated)
//
// The endpoint is idempotent on the slot — if it's already sentinel-
// marked, we no-op gracefully.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { cancelCalendlyEvent } from "@/lib/calendly/api";
import { brandedEmailHtml } from "@/lib/email/template";
import { resend, FROM_EMAIL } from "@/lib/email/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASONS = ["sick", "out_of_control", "need_to_reschedule"] as const;
type ReasonValue = (typeof REASONS)[number];

const bodySchema = z
  .object({
    slot_id: z.string().uuid(),
    reason: z.enum(REASONS),
    confirm: z.literal("CANCEL"),
  })
  .strict();

// Parent-facing phrasing per reason. Dash-free per Hard rule #8.
const REASON_COPY: Record<
  ReasonValue,
  { parentBlurb: string; kidBlurb: string; subject: string }
> = {
  sick: {
    parentBlurb: "Tim's out sick this week, so we're pushing this week's call.",
    kidBlurb: "I'm out sick this week. Catch you next week.",
    subject: "Tim's out sick this week",
  },
  out_of_control: {
    parentBlurb:
      "Something came up Tim couldn't control, so we're pushing this week's call.",
    kidBlurb: "Something came up I couldn't get out of. Catch you next week.",
    subject: "Tim has to push this week's call",
  },
  need_to_reschedule: {
    parentBlurb:
      "Tim needs to move this week's call. He'll reach out shortly to find a new time.",
    kidBlurb:
      "I have to move this week's call. I'll message you about a new time soon.",
    subject: "Tim needs to move this week's call",
  },
};

type SlotLookup = {
  id: string;
  curriculum_id: string;
  live_call_at: string | null;
  live_call_event_id: string | null;
  week_number: number;
  delivered_at: string | null;
};
type CurriculumLookup = { id: string; player_id: string };
type PlayerLookup = {
  id: string;
  first_name: string;
  family_id: string;
  discord_username: string | null;
};
type ParentLookup = { family_id: string; first_name: string; email: string };

export async function POST(req: Request) {
  // Coach gate
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const coachRow = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  const coach = coachRow.data as { id: string } | null;
  if (!coach) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();

  // Resolve slot → curriculum → player → parent
  const slotRow = await service
    .from("curriculum_slots")
    .select(
      "id, curriculum_id, live_call_at, live_call_event_id, week_number, delivered_at",
    )
    .eq("id", body.slot_id)
    .maybeSingle();
  const slot = slotRow.data as SlotLookup | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });

  // Idempotency: if already sentinel-marked, return ok.
  if (slot.live_call_event_id?.startsWith("cancelled:")) {
    return NextResponse.json({ ok: true, already_cancelled: true });
  }
  if (slot.delivered_at) {
    return NextResponse.json({ error: "slot_already_delivered" }, { status: 400 });
  }

  const curriculumRow = await service
    .from("curricula")
    .select("id, player_id")
    .eq("id", slot.curriculum_id)
    .maybeSingle();
  const curriculum = curriculumRow.data as CurriculumLookup | null;
  if (!curriculum) {
    return NextResponse.json({ error: "curriculum_not_found" }, { status: 404 });
  }

  const playerRow = await service
    .from("players")
    .select("id, first_name, family_id, discord_username")
    .eq("id", curriculum.player_id)
    .maybeSingle();
  const player = playerRow.data as PlayerLookup | null;
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const parentRow = await service
    .from("parents")
    .select("family_id, first_name, email")
    .eq("family_id", player.family_id)
    .limit(1)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;

  const nowIso = new Date().toISOString();
  const copy = REASON_COPY[body.reason];

  // 1. coach_cancels audit row
  const cancelInsert = await service.from("coach_cancels").insert({
    coach_id: coach.id,
    curriculum_slot_id: slot.id,
    scope: "individual",
    reason: body.reason,
    bypassed_24hr_gate: true,
  } as never);
  if (cancelInsert.error) {
    console.error("[admin/calendar/coach-cancel] coach_cancels insert failed", cancelInsert.error);
    return NextResponse.json({ error: "cancel_insert_failed" }, { status: 500 });
  }

  // 2. Cancel Calendly event (best-effort)
  if (slot.live_call_event_id) {
    const calResult = await cancelCalendlyEvent(
      slot.live_call_event_id,
      `Coach cancel: ${body.reason}`,
    );
    if (!calResult.ok) {
      console.error("[admin/calendar/coach-cancel] Calendly cancel failed", calResult);
      // Don't bail — local state is the source of truth.
    }
  }

  // 3. Mark slot: sentinel + delivered (so Sunday cron skips)
  const slotUpd = await service
    .from("curriculum_slots")
    .update({
      live_call_event_id: slot.live_call_event_id
        ? `cancelled:${slot.live_call_event_id}`
        : `cancelled:coach-${slot.id}`,
      delivered_at: nowIso,
    } as never)
    .eq("id", slot.id);
  if (slotUpd.error) {
    console.error("[admin/calendar/coach-cancel] slot update failed", slotUpd.error);
    return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
  }

  // 4. Parent email
  if (parent && process.env.RESEND_API_KEY) {
    const html = brandedEmailHtml({
      headline: copy.subject,
      bodyHtml: `<p>Hi ${parent.first_name},</p>
<p>${copy.parentBlurb}</p>
<p>${player.first_name}'s cycle pauses one week. No charge for this week, no impact on your skip allowance.</p>
<p>Anything to share? Have ${player.first_name} message me in the chat. I see everything in your dashboard.</p>
<p>Talk soon,<br/>Tim</p>`,
    });
    try {
      await resend.emails.send({
        from: `XPL Keyed <${FROM_EMAIL.replace(/^.*<|>$/g, "")}>`,
        to: parent.email,
        subject: copy.subject,
        html,
      });
    } catch (err) {
      console.error("[admin/calendar/coach-cancel] parent email send failed", err);
      // Non-fatal — local state is committed already.
    }
  }

  // 5. Auto-chat to the kid (sender_role='coach', templated in Tim's voice)
  const kidMessage = `Hey ${player.first_name}, ${copy.kidBlurb}`;
  const msgInsert = await service.from("messages").insert({
    player_id: player.id,
    sender_role: "coach",
    sender_id: coach.id,
    body: kidMessage,
    waiting_on: "KID",
  } as never);
  if (msgInsert.error) {
    console.error("[admin/calendar/coach-cancel] kid message insert failed", msgInsert.error);
    // Non-fatal.
  }

  return NextResponse.json({ ok: true });
}
