// POST /api/admin/calendar/mark-outcome
//
// Tim marks how a live call actually ended. Three outcomes:
//
//   outcome='done'
//     → live_call_completed_at = NOW()
//     → optional coach_note stamps coach_note + coach_note_at
//       (surfaces on /portal/progress for the parent)
//
//   outcome='no_show'
//     → no_show_at = NOW()
//     → if charge_skip=true (default): cycle_skips_used+1,
//        cycle_lessons_delivered+1, classification='forfeit'
//        cancellation_events row. Email parent "Hope all is well."
//     → if charge_skip=false (courtesy pass): coach_cancels row
//        instead. No skip. Cycle pauses 1 week. Email parent
//        "Hope all is well, no charge this week."
//
//   outcome='coach_cancel_late'
//     → after-the-fact coach cancel. Same shape as the proactive
//       coach-cancel endpoint: coach_cancels row, parent email in
//       Tim's voice, auto-chat to kid, slot sentinel'd.
//
// All three drop the call_outcome_pending Focused Home task.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { cancelCalendlyEvent } from "@/lib/calendly/api";
import { brandedEmailHtml } from "@/lib/email/template";
import { resend, FROM_EMAIL } from "@/lib/email/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASONS = ["sick", "out_of_control", "need_to_reschedule"] as const;

const bodySchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("done"),
    slot_id: z.string().uuid(),
    coach_note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    outcome: z.literal("no_show"),
    slot_id: z.string().uuid(),
    charge_skip: z.boolean(),
  }),
  z.object({
    outcome: z.literal("coach_cancel_late"),
    slot_id: z.string().uuid(),
    reason: z.enum(REASONS),
  }),
]);

const COACH_REASON_COPY: Record<
  (typeof REASONS)[number],
  { parentBlurb: string; kidBlurb: string; subject: string }
> = {
  sick: {
    parentBlurb: "I was out sick and missed today's call. So sorry I didn't get word to you sooner.",
    kidBlurb: "I was out sick today. So sorry I missed our call. Your parent has a link to pick a new time.",
    subject: "Picking a new time for the call I missed",
  },
  out_of_control: {
    parentBlurb:
      "Something came up I couldn't control and I missed today's call. So sorry I didn't get word to you sooner.",
    kidBlurb:
      "Something came up I couldn't get out of. So sorry I missed our call. Your parent has a link to pick a new time.",
    subject: "Picking a new time for the call I missed",
  },
  need_to_reschedule: {
    parentBlurb:
      "I had to step away today and missed our call. So sorry I didn't reach out sooner. Pick a new time below and I'll be there.",
    kidBlurb:
      "I had to step away today. So sorry I missed our call. Your parent has a link to pick a new time.",
    subject: "Picking a new time for the call I missed",
  },
};

type SlotLookup = {
  id: string;
  curriculum_id: string;
  live_call_at: string | null;
  live_call_event_id: string | null;
  live_call_completed_at: string | null;
  no_show_at: string | null;
  delivered_at: string | null;
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
  auto_renew_enabled: boolean;
};

export async function POST(req: Request) {
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

  const slotRow = await service
    .from("curriculum_slots")
    .select(
      "id, curriculum_id, live_call_at, live_call_event_id, live_call_completed_at, no_show_at, delivered_at, week_number",
    )
    .eq("id", body.slot_id)
    .maybeSingle();
  const slot = slotRow.data as SlotLookup | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });

  // Idempotency check
  if (slot.live_call_completed_at || slot.no_show_at) {
    return NextResponse.json({ ok: true, already_marked: true });
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
    .select("id, first_name, family_id")
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

  const subRow = await service
    .from("subscriptions")
    .select(
      "id, cycle_skips_used, cycle_cancels_used, cycle_lessons_delivered, auto_renew_enabled",
    )
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subRow.data as SubLookup | null;

  const nowIso = new Date().toISOString();

  // ----------------------------------------------------------------------
  // outcome='done' — happy path
  // ----------------------------------------------------------------------
  if (body.outcome === "done") {
    const note = body.coach_note?.trim() ?? null;
    const upd = await service
      .from("curriculum_slots")
      .update({
        live_call_completed_at: nowIso,
        delivered_at: nowIso,
        coach_note: note || null,
        coach_note_at: note ? nowIso : null,
      } as never)
      .eq("id", slot.id);
    if (upd.error) {
      console.error("[mark-outcome:done] slot update failed", upd.error);
      return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
    }

    // Advance the cycle counter. Sunday cron uses this for what-to-ship-next.
    if (sub) {
      await service
        .from("subscriptions")
        .update({
          cycle_lessons_delivered: sub.cycle_lessons_delivered + 1,
        } as never)
        .eq("id", sub.id);
    }

    return NextResponse.json({ ok: true, outcome: "done" });
  }

  // ----------------------------------------------------------------------
  // outcome='no_show' — kid didn't show
  // ----------------------------------------------------------------------
  if (body.outcome === "no_show") {
    const upd = await service
      .from("curriculum_slots")
      .update({
        no_show_at: nowIso,
        delivered_at: nowIso,
      } as never)
      .eq("id", slot.id);
    if (upd.error) {
      console.error("[mark-outcome:no_show] slot update failed", upd.error);
      return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
    }

    if (body.charge_skip && sub) {
      // Forfeit-equivalent: +1 skip, +1 lesson delivered (kid kept the
      // materials), audit row, auto-renew check.
      const newSkipsUsed = sub.cycle_skips_used + 1;
      const newCancelsUsed = sub.cycle_cancels_used + 1;
      const triggeredAutoRenewOff = newSkipsUsed >= 3 && sub.auto_renew_enabled;

      await service
        .from("subscriptions")
        .update({
          cycle_skips_used: newSkipsUsed,
          cycle_cancels_used: newCancelsUsed,
          cycle_lessons_delivered: sub.cycle_lessons_delivered + 1,
          last_cancel_at: nowIso,
          auto_renew_enabled: triggeredAutoRenewOff ? false : sub.auto_renew_enabled,
        } as never)
        .eq("id", sub.id);

      await service.from("cancellation_events").insert({
        subscription_id: sub.id,
        curriculum_slot_id: slot.id,
        initiated_via: "no_show",
        hours_until_call: 0,
        classification: "forfeit",
        cycle_cancels_used_after: newSkipsUsed,
        triggered_pending_cancel: false,
        waiting_on: "SYSTEM",
      } as never);
    } else {
      // Courtesy pass: treat like a coach cancel. No skip. Cycle pauses.
      // We do NOT advance cycle_lessons_delivered (the slot is delivered_at
      // for the Sunday cron's sake, but the cycle counter shouldn't tick).
      await service.from("coach_cancels").insert({
        coach_id: coach.id,
        curriculum_slot_id: slot.id,
        scope: "individual",
        reason: "no_show_courtesy_pass",
        bypassed_24hr_gate: true,
      } as never);
    }

    // Parent email — "Hope all is well"
    if (parent && process.env.RESEND_API_KEY) {
      const headline = body.charge_skip
        ? `We missed ${player.first_name} today`
        : `We missed ${player.first_name} today, no charge this week`;
      const html = brandedEmailHtml({
        headline,
        bodyHtml: `<p>Hi ${parent.first_name},</p>
<p>${player.first_name} didn't make it to today's call. Hope all is well.</p>
${
  body.charge_skip
    ? `<p>${player.first_name} keeps the slides and voiceover for the week. This counts as 1 skip from your 2 per cycle.</p>`
    : `<p>No charge this week. The cycle pauses by one week and your skip count isn't affected.</p>`
}
<p>Anything to share? Have ${player.first_name} message me in the chat. I see everything in your dashboard.</p>
<p>Talk soon,<br/>Tim</p>`,
      });
      try {
        await resend.emails.send({
          from: `XPL Keyed <${FROM_EMAIL.replace(/^.*<|>$/g, "")}>`,
          to: parent.email,
          subject: headline,
          html,
        });
      } catch (err) {
        console.error("[mark-outcome:no_show] email send failed", err);
      }
    }

    return NextResponse.json({ ok: true, outcome: "no_show", charged_skip: body.charge_skip });
  }

  // ----------------------------------------------------------------------
  // outcome='coach_cancel_late' — Tim forgot / overslept / sick that morning
  // ----------------------------------------------------------------------
  if (body.outcome === "coach_cancel_late") {
    const copy = COACH_REASON_COPY[body.reason];

    // coach_cancels row
    await service.from("coach_cancels").insert({
      coach_id: coach.id,
      curriculum_slot_id: slot.id,
      scope: "individual",
      reason: body.reason,
      bypassed_24hr_gate: true,
    } as never);

    // Calendly cancel (best-effort; usually the event already passed)
    if (slot.live_call_event_id) {
      await cancelCalendlyEvent(
        slot.live_call_event_id,
        `Coach late cancel: ${body.reason}`,
      ).catch(() => null);
    }

    // Mark slot: sentinel event id + clear live_call_at (slot enters
    // "needs reschedule" state, same shape as proactive coach cancel).
    await service
      .from("curriculum_slots")
      .update({
        live_call_event_id: slot.live_call_event_id
          ? `cancelled:${slot.live_call_event_id}`
          : `cancelled:coach-late-${slot.id}`,
        live_call_at: null,
      } as never)
      .eq("id", slot.id);

    // Parent email with reschedule CTA
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://xplkeyed.com";
    if (parent && process.env.RESEND_API_KEY) {
      const html = brandedEmailHtml({
        headline: copy.subject,
        bodyHtml: `<p>Hi ${parent.first_name},</p>
<p>${copy.parentBlurb}</p>
<p>No charge for this delay, no impact on your skip allowance. Pick the next time that works and I'll be there.</p>
<p>Anything to share? Have ${player.first_name} message me in the chat.</p>
<p>Talk soon,<br/>Tim</p>`,
        ctaLabel: "Pick a new time",
        ctaHref: `${appUrl}/portal/sessions`,
      });
      try {
        await resend.emails.send({
          from: `XPL Keyed <${FROM_EMAIL.replace(/^.*<|>$/g, "")}>`,
          to: parent.email,
          subject: copy.subject,
          html,
        });
      } catch (err) {
        console.error("[mark-outcome:coach_cancel_late] email send failed", err);
      }
    }

    // Auto-chat to kid
    await service.from("messages").insert({
      player_id: player.id,
      sender_role: "coach",
      sender_id: coach.id,
      body: `Hey ${player.first_name}, ${copy.kidBlurb}`,
      waiting_on: "KID",
    } as never);

    return NextResponse.json({ ok: true, outcome: "coach_cancel_late" });
  }

  return NextResponse.json({ error: "unknown_outcome" }, { status: 400 });
}
