// POST /api/admin/calendar/mark-outcome
//
// Tim marks how a live call actually ended. Three outcomes:
//
//   outcome='done'
//     → live_call_completed_at = NOW()
//     → coach_note        (advice for the player, their vocabulary)
//     → training_routine  (what they do between calls)
//     → parent_summary    (parent legible line, Hard rule #4)
//       All three surface on /portal/progress; coach_note +
//       training_routine also drive the player's My Training view.
//     → advances the billing cycle exactly once. See advanceCycleOnce.
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
import { sendBrandedEmail } from "@/lib/email/send";
import { sendSessionRecapEmail } from "@/lib/coaching/session-recap-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASONS = ["sick", "out_of_control", "need_to_reschedule"] as const;

const bodySchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("done"),
    slot_id: z.string().uuid(),
    // Advice for the player. Their vocabulary, game terms fine.
    coach_note: z.string().trim().max(2000).optional(),
    // What the player works on before the next call.
    training_routine: z.string().trim().max(4000).optional(),
    // Parent legible line. Hard rule #4: real world skill first, any
    // Fortnite term in italicised parens.
    parent_summary: z.string().trim().max(2000).optional(),
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
  cycle_counted_at: string | null;
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


// ---------------------------------------------------------------------------
// advanceCycleOnce
// ---------------------------------------------------------------------------
// Moves a family one session closer to their next $56 charge, at most once
// per slot, and says out loud whether it worked.
//
// Why this exists. $56 buys 4 sessions and cron-auto-renew-detection fires
// the next charge on cycle_lessons_delivered = 4. Once the content delivery
// path is gone, a COMPLETED CALL is the only thing that advances the cycle,
// so this increment is the single point of failure for revenue. Before, it
// was `await service.from("subscriptions").update(...)` with the error
// discarded: a failed write left the call marked done and the family never
// billed, with nothing on any screen.
//
// PostgREST gives us no transaction, so the two writes cannot be atomic.
// The ordering is therefore chosen for WHICH WAY IT FAILS:
//
//   claim the slot, then increment
//     worst case = a crash between the two leaves the cycle one short.
//     Recoverable, and a retry repairs it.
//
//   increment, then claim
//     worst case = a crash between the two leaves the slot unclaimed with
//     the counter already moved, so a retry bills the parent twice.
//
// One short is a support message. Charging a parent twice is not. When you
// cannot be atomic, fail in the direction that does not overcharge.
//
// The claim is a conditional UPDATE on cycle_counted_at IS NULL returning
// its rows, so concurrent callers cannot both win it.
async function advanceCycleOnce(
  service: ReturnType<typeof createServiceRoleClient>,
  slotId: string,
  sub: SubLookup,
  nowIso: string,
): Promise<"advanced" | "already_counted" | "failed"> {
  const claim = await service
    .from("curriculum_slots")
    .update({ cycle_counted_at: nowIso } as never)
    .eq("id", slotId)
    .is("cycle_counted_at", null)
    .select("id");

  if (claim.error) {
    console.error("[mark-outcome] cycle claim failed", claim.error);
    return "failed";
  }
  if ((claim.data ?? []).length === 0) return "already_counted";

  const bump = await service
    .from("subscriptions")
    .update({ cycle_lessons_delivered: sub.cycle_lessons_delivered + 1 } as never)
    .eq("id", sub.id)
    .select("id");

  if (bump.error || (bump.data ?? []).length === 0) {
    // Hand the claim back so a retry can advance rather than being told
    // the session was already counted when it was not.
    await service
      .from("curriculum_slots")
      .update({ cycle_counted_at: null } as never)
      .eq("id", slotId);
    console.error("[mark-outcome] cycle advance failed, claim released", bump.error);
    return "failed";
  }

  return "advanced";
}

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
      "id, curriculum_id, live_call_at, live_call_event_id, live_call_completed_at, no_show_at, delivered_at, week_number, cycle_counted_at",
    )
    .eq("id", body.slot_id)
    .maybeSingle();
  const slot = slotRow.data as SlotLookup | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });

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

  // Idempotency check. Deliberately AFTER the subscription lookup: the
  // repair path below needs `sub`, and typecheck caught it being read
  // before assignment when this sat higher up. The cost is four extra
  // reads on a double submit, which is the rare path.
  //
  // This used to return immediately, which meant a `done` call whose cycle
  // advance had failed could never be repaired: the retry short circuited
  // here and the family stayed unbilled forever. Now an already marked slot
  // still gets the chance to finish advancing the cycle, because
  // cycle_counted_at (not the outcome fields) is what records whether the
  // session was counted.
  if (slot.live_call_completed_at || slot.no_show_at) {
    if (body.outcome === "done" && sub && !slot.cycle_counted_at) {
      const repaired = await advanceCycleOnce(service, slot.id, sub, new Date().toISOString());
      if (repaired === "failed") {
        return NextResponse.json({ error: "cycle_advance_failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, already_marked: true, cycle: repaired });
    }
    return NextResponse.json({ ok: true, already_marked: true });
  }


  const nowIso = new Date().toISOString();

  // ----------------------------------------------------------------------
  // outcome='done' — happy path
  // ----------------------------------------------------------------------
  if (body.outcome === "done") {
    const note = body.coach_note?.trim() || null;
    const routine = body.training_routine?.trim() || null;
    const summary = body.parent_summary?.trim() || null;

    // delivered_at stays. It does not mean "materials were delivered"; it
    // means "this session is settled". A coach cancel stamps it, a no show
    // stamps it, a completed call stamps it, and the scheduling and cancel
    // paths all read it. It is the consumed session flag.
    const upd = await service
      .from("curriculum_slots")
      .update({
        live_call_completed_at: nowIso,
        delivered_at: nowIso,
        coach_note: note,
        coach_note_at: note ? nowIso : null,
        training_routine: routine,
        training_routine_at: routine ? nowIso : null,
        parent_summary: summary,
        parent_summary_at: summary ? nowIso : null,
      } as never)
      .eq("id", slot.id);
    if (upd.error) {
      console.error("[mark-outcome:done] slot update failed", upd.error);
      return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
    }

    // The billing advance. Reported in the response rather than swallowed,
    // because after the content delivery path is removed this is the only
    // thing that moves a family toward their next charge.
    let cycle: "advanced" | "already_counted" | "failed" | "no_subscription" =
      "no_subscription";
    if (sub) {
      cycle = await advanceCycleOnce(service, slot.id, sub, nowIso);
      if (cycle === "failed") {
        // The call IS marked done, which is true and should stand. What
        // failed is the billing advance, and saying so is the whole point:
        // the retry path above repairs it.
        return NextResponse.json(
          { error: "cycle_advance_failed", outcome: "done", marked: true },
          { status: 500 },
        );
      }
    }

    // Post session recap to the parent. This is the email that replaces
    // cron-sunday-lesson-delivery as the routine parent touchpoint.
    //
    // Only fires when Tim actually wrote something. Marking a call done with
    // no note and no routine is a legitimate thing to do (he may write it up
    // later), and an email saying "here is where it landed" with nothing in
    // it would be noise that teaches parents to ignore the next one.
    //
    // Deliberately NOT awaited into the response contract: the call is
    // marked, the cycle is advanced, and a mail failure must not make Tim
    // think the outcome did not save. sendBrandedEmail already writes its own
    // notification_log row on failure, so a silent send failure is still
    // recorded somewhere.
    if (parent && (note || routine)) {
      try {
        await sendSessionRecapEmail({
          parentEmail: parent.email,
          parentFirstName: parent.first_name,
          kidFirstName: player.first_name,
          parentSummary: summary,
          hasRoutine: !!routine,
          slotId: slot.id,
        });
      } catch (err) {
        console.error("[mark-outcome:done] recap email failed", err);
      }
    }

    return NextResponse.json({ ok: true, outcome: "done", cycle });
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

      // Skip counters are not idempotency sensitive the way the cycle
      // counter is (the top level already_marked guard stops a second pass),
      // so they move here. The cycle advance goes through the shared claim
      // so a forfeited session is counted exactly once, same as a completed
      // one.
      await service
        .from("subscriptions")
        .update({
          cycle_skips_used: newSkipsUsed,
          cycle_cancels_used: newCancelsUsed,
          last_cancel_at: nowIso,
          auto_renew_enabled: triggeredAutoRenewOff ? false : sub.auto_renew_enabled,
        } as never)
        .eq("id", sub.id);

      const forfeitCycle = await advanceCycleOnce(
        service,
        slot.id,
        { ...sub, cycle_lessons_delivered: sub.cycle_lessons_delivered },
        nowIso,
      );
      if (forfeitCycle === "failed") {
        console.error("[mark-outcome:no_show] cycle advance failed for slot", slot.id);
      }

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
    ? `<p>The call is the session, so this one is used up. This counts as 1 skip from your 2 per cycle.</p>`
    : `<p>No charge this week. The cycle pauses by one week and your skip count isn't affected.</p>`
}
<p>Anything to share? Have ${player.first_name} message me in the chat. I see everything in your dashboard.</p>
<p>Talk soon,<br/>Tim</p>`,
      });
      await sendBrandedEmail({
        to: parent.email,
        subject: headline,
        html,
        trigger: "no_show",
        recipientType: "parent",
        relatedEntityType: "curriculum_slot",
        relatedEntityId: slot.id,
      });
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
      await sendBrandedEmail({
        to: parent.email,
        subject: copy.subject,
        html,
        trigger: "coach_cancel_late",
        recipientType: "parent",
        relatedEntityType: "curriculum_slot",
        relatedEntityId: slot.id,
      });
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
