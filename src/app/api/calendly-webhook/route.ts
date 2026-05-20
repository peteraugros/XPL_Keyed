// Calendly webhook handler. Handles parent-initiated cancels arriving via
// either (a) Calendly's native cancel/reschedule link in booking emails or
// (b) the parent portal's [Cancel this week] CTA, which deep-links Calendly's
// cancel page. Either way, Calendly fires invitee.canceled to us and we are
// the system of record for the 24hr rule, the 2-per-cycle cap, and the
// cancel-#3 -> pending_cancel transition.
//
// Calendly setup the handler depends on (see CLAUDE.md Human Setup):
//   - Cancel/reschedule window in Calendly settings: 0hr (otherwise Calendly
//     silently blocks late cancels and we never see them).
//   - Webhook subscription registered against this route (Calendly's webhook
//     create is API-only, not in the dashboard).
//   - CALENDLY_WEBHOOK_SECRET set to the signing secret returned at
//     subscription-create time.
//
// Trial-call cancellations and the invitee.created reschedule chain are
// deferred until the intake flow lands (task #5). For now those paths
// return 200 with no-op so Calendly doesn't retry.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { stripe } from "@/lib/stripe/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resend, FROM_EMAIL } from "@/lib/email/resend";
import { brandedEmailHtml } from "@/lib/email/template";
import { sendDirectMessage } from "@/lib/discord/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK_SECRET = process.env.CALENDLY_WEBHOOK_SECRET;
const SIGNATURE_TOLERANCE_SECONDS = 300; // 5 minutes; replay protection
const CREDIT_THRESHOLD_HOURS = 24;
const PENDING_CANCEL_WINDOW_DAYS = 7;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type Supa = ReturnType<typeof createServiceRoleClient>;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!WEBHOOK_SECRET) {
    console.error("[calendly-webhook] CALENDLY_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sig = req.headers.get("calendly-webhook-signature");
  const rawBody = await req.text();

  if (!verifySignature(rawBody, sig, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: CalendlyWebhookBody;
  try {
    body = JSON.parse(rawBody) as CalendlyWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  try {
    switch (body.event) {
      case "invitee.canceled":
        await handleInviteeCanceled(body.payload, supabase);
        break;
      case "invitee.created":
        await handleInviteeCreated(body.payload, supabase);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error("[calendly-webhook]", body.event, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true, event: body.event });
}

// ---------------------------------------------------------------------------
// invitee.canceled
// ---------------------------------------------------------------------------

async function handleInviteeCanceled(payload: InviteePayload, supabase: Supa) {
  // Reschedules also fire invitee.canceled. Per CLAUDE.md, reschedules do NOT
  // count toward the 2/cycle cap. The new booking arrives as invitee.created
  // with rescheduled_from set; that handler updates the slot's live_call_at.
  if (payload.rescheduled === true) return;

  const eventUri = payload.event ?? payload.scheduled_event?.uri;
  if (!eventUri) return;

  // Coach cancels go through Tim's admin (writes to coach_cancels), not here.
  // If Tim happens to cancel via the Calendly UI we still receive the event,
  // but the canceler_type='host' branch is treated like a coach cancel:
  // pause the family's cycle, no cap impact.
  const canceledByHost = payload.cancellation?.canceler_type === "host";

  const slot = await fetchSlotByEventUri(eventUri, supabase);
  if (!slot) {
    // Trial-call cancel, or a slot we don't track yet. No-op for MVP.
    return;
  }

  const subscription = await fetchSubscriptionForSlot(slot.subscription_id, supabase);
  if (!subscription) return;

  if (canceledByHost) {
    await applyCoachCancel(slot, supabase);
    return;
  }

  // Phase 2: pre-payment paid-lesson cancel. The parent booked a slot
  // during the scheduling wizard then cancelled before paying. Clear
  // the slot so the wizard re-offers it; don't touch cycle_cancels_used
  // (the cycle hasn't started). Step lifecycle back if we were already
  // at PENDING_PAYMENT.
  const lifecycle = (subscription as { lifecycle_state?: string }).lifecycle_state;
  if (
    lifecycle === "ACCEPTED_PENDING_SCHEDULING" ||
    lifecycle === "SCHEDULING_IN_PROGRESS" ||
    lifecycle === "PENDING_PAYMENT"
  ) {
    await supabase
      .from("curriculum_slots")
      .update({ live_call_at: null, live_call_event_id: null } as never)
      .eq("id", slot.id);
    // Step lifecycle back if needed: PENDING_PAYMENT -> SCHEDULING_IN_PROGRESS
    // (still have bookings) or -> ACCEPTED_PENDING_SCHEDULING (no bookings left).
    // curriculum_slots is keyed by curriculum_id, not subscription_id, so we
    // resolve the curriculum first.
    const slotRow = await supabase
      .from("curriculum_slots")
      .select("curriculum_id")
      .eq("id", slot.id)
      .maybeSingle();
    const curriculumId = (slotRow.data as { curriculum_id: string } | null)?.curriculum_id;
    if (!curriculumId) return;
    const remainingRow = await supabase
      .from("curriculum_slots")
      .select("id, live_call_at")
      .eq("curriculum_id", curriculumId);
    const remaining = (remainingRow.data ?? []) as Array<{ live_call_at: string | null }>;
    const stillBooked = remaining.filter((s) => s.live_call_at).length;
    const newLifecycle =
      stillBooked === 0 ? "ACCEPTED_PENDING_SCHEDULING" : "SCHEDULING_IN_PROGRESS";
    await supabase
      .from("subscriptions")
      .update({
        lifecycle_state: newLifecycle,
        waiting_on: "PARENT",
        payment_pending_at: null,
      } as never)
      .eq("id", slot.subscription_id);
    return;
  }

  const liveCallAt = slot.live_call_at ? new Date(slot.live_call_at) : null;
  const hoursUntilCall =
    liveCallAt !== null ? (liveCallAt.getTime() - Date.now()) / (1000 * 60 * 60) : null;

  const classification: "credit" | "forfeit" =
    hoursUntilCall !== null && hoursUntilCall >= CREDIT_THRESHOLD_HOURS ? "credit" : "forfeit";

  await applyParentCancel({
    slot,
    subscription,
    classification,
    hoursUntilCall,
    supabase,
  });
}

type ApplyParentCancelArgs = {
  slot: SlotRow;
  subscription: SubscriptionRow;
  classification: "credit" | "forfeit";
  hoursUntilCall: number | null;
  supabase: Supa;
};

async function applyParentCancel(args: ApplyParentCancelArgs) {
  const { slot, subscription, classification, hoursUntilCall, supabase } = args;
  const nowIso = new Date().toISOString();

  // New unified skip model per xpl-reschedule-spec.md. Both credit
  // (>=24hr) and forfeit (<24hr) cancels count as 1 skip. Forfeit also
  // advances cycle_lessons_delivered (kid keeps materials). Allowance
  // is 2 skips per cycle; the 3rd skip flips auto_renew_enabled=FALSE.
  // Current cycle still continues through lesson 4, then ends. No
  // more pending_cancel triggered from here — that path is retired in
  // favor of the auto-renew model.
  const newSkipsUsed = subscription.cycle_skips_used + 1;
  const newCancelsUsed = subscription.cycle_cancels_used + 1;
  const newLessonsDelivered =
    classification === "forfeit"
      ? subscription.cycle_lessons_delivered + 1
      : subscription.cycle_lessons_delivered;
  const triggeredAutoRenewOff =
    newSkipsUsed >= 3 && subscription.auto_renew_enabled;

  const { error: subErr } = await supabase
    .from("subscriptions")
    .update({
      last_cancel_at: nowIso,
      cycle_skips_used: newSkipsUsed,
      cycle_cancels_used: newCancelsUsed,
      cycle_lessons_delivered: newLessonsDelivered,
      auto_renew_enabled: triggeredAutoRenewOff ? false : subscription.auto_renew_enabled,
    } as never)
    .eq("id", subscription.id);
  if (subErr) throw subErr;

  // Audit row. waiting_on='SYSTEM' because our handler auto-classifies
  // credit vs forfeit per the 24hr rule. The triggered_pending_cancel
  // column is kept FALSE; rename / drop it in a follow-up migration once
  // the new model is in production for all subscriptions.
  const { error: evErr } = await supabase.from("cancellation_events").insert({
    subscription_id: subscription.id,
    curriculum_slot_id: slot.id,
    initiated_via: "calendly_link",
    hours_until_call: hoursUntilCall,
    classification,
    cycle_cancels_used_after: newSkipsUsed,
    triggered_pending_cancel: false,
    waiting_on: "SYSTEM",
  });
  if (evErr) throw evErr;

  // Sentinel-mark the slot's event id so a duplicate webhook firing
  // (or a stale Calendly retry) doesn't re-apply the cancel. Forfeit
  // advances delivered_at so the Sunday cron doesn't re-ship.
  const slotUpd = await supabase
    .from("curriculum_slots")
    .update(
      classification === "forfeit"
        ? { delivered_at: nowIso, live_call_event_id: `cancelled:${args.slot.id}` }
        : { live_call_event_id: `cancelled:${args.slot.id}` },
    )
    .eq("id", slot.id);
  if (slotUpd.error) {
    console.error("[calendly-webhook][cancel] slot update failed", slotUpd.error);
  }

  if (triggeredAutoRenewOff) {
    await notifyParentAutoRenewOff(subscription, supabase);
  } else {
    // Standard cancel email (credit vs forfeit copy).
    await notifyParent({
      subscription,
      classification,
      triggeredPendingCancel: false,
    });
  }
}

// Email when the cancel just turned off auto-renew.
async function notifyParentAutoRenewOff(
  subscription: SubscriptionRow,
  supabase: Supa,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const { data: player } = await supabase
    .from("players")
    .select("first_name, family_id")
    .eq("id", subscription.player_id)
    .maybeSingle();
  const familyId = (player as { family_id?: string } | null)?.family_id;
  if (!familyId) return;
  const { data: parent } = await supabase
    .from("parents")
    .select("first_name, email")
    .eq("family_id", familyId)
    .limit(1)
    .maybeSingle();
  const p = parent as { first_name: string; email: string } | null;
  if (!p) return;
  const kidFirstName = (player as { first_name: string } | null)?.first_name ?? "your player";
  const html = brandedEmailHtml({
    headline: "Auto renew is off for the next cycle",
    bodyHtml: `<p>Hi ${p.first_name},</p>
<p>${kidFirstName} hit their 3rd skip this cycle, so auto renew is off for the next cycle. The current cycle still finishes through lesson 4 as planned. No surprise charges.</p>
<p>If you want to keep going after this cycle, sign back into your dashboard and book a new cycle. Your progress and history are saved.</p>
<p>Anything to share? Have ${kidFirstName} message me in the chat. You see everything in your dashboard.</p>
<p>Peter<br/>(Tim's dad, who runs the back end of XPL Keyed)</p>`,
  });
  await resend.emails.send({
    from: `XPL Keyed <${FROM_EMAIL.replace(/^.*<|>$/g, "")}>`,
    to: p.email,
    subject: "Auto renew off for the next cycle",
    html,
  });
}

// ---------------------------------------------------------------------------
// invitee.created — branded booking confirmation
// ---------------------------------------------------------------------------
// Calendly's stock invitee email is generic and verbose (see CLAUDE.md
// "branded confirmation email"). Peter turns it off in the event type
// settings; this handler owns the parent-facing confirmation.
//
// For MVP every invitee.created we see is a trial intro call — paid lessons
// aren't bookable via Calendly until the paid-lessons event type ships.
// When it does, branch here on `scheduled_event.event_type` URI / slug.
//
// Reschedules also fire invitee.created (with rescheduled_from set). For now
// we send the same branded email — content reads identically and the parent
// gets confirmation of the new time. Reschedule-specific copy can be a
// follow-up.

// Phase 2 discriminator. Returns true if the booking is for a paid
// lesson event type, false for the free intro call. Resolution order:
//   1. CALENDLY_PAID_LESSON_EVENT_TYPE_URI env var exact match on
//      scheduled_event.event_type URI (canonical).
//   2. Display name substring match — any event type whose name
//      includes "paid" (case-insensitive).
//   3. Otherwise assume intro call.
function isPaidLessonBooking(payload: InviteePayload): boolean {
  const eventTypeUri = payload.scheduled_event?.event_type;
  const paidEventTypeUri = process.env.CALENDLY_PAID_LESSON_EVENT_TYPE_URI;
  if (paidEventTypeUri && eventTypeUri && eventTypeUri === paidEventTypeUri) {
    return true;
  }
  const name = payload.scheduled_event?.name?.toLowerCase() ?? "";
  if (name.includes("paid")) return true;
  return false;
}

async function handleInviteeCreated(payload: InviteePayload, supabase: Supa) {
  const startIso = payload.scheduled_event?.start_time;
  const parentEmail = payload.email;
  const eventUri = payload.scheduled_event?.uri ?? payload.event ?? null;
  if (!startIso || !parentEmail) {
    console.warn("[calendly-webhook] invitee.created missing start_time or email", {
      hasStart: !!startIso,
      hasEmail: !!parentEmail,
    });
    return;
  }

  if (isPaidLessonBooking(payload)) {
    await handlePaidLessonCreated(payload, supabase, startIso, parentEmail, eventUri);
    return;
  }

  // ---- Substate wiring: store trial_call_at + flip lifecycle ------------
  // Find the subscription by parent email -> family -> player -> sub.
  // If no match yet (intake hasn't finished writing rows by the time
  // Calendly fires the webhook), log + skip the substate update; the
  // confirmation email still goes out below.
  try {
    const parentRow = await supabase
      .from("parents")
      .select("family_id")
      .ilike("email", parentEmail)
      .maybeSingle();
    const parent = parentRow.data as { family_id: string } | null;
    if (parent) {
      const playerRow = await supabase
        .from("players")
        .select("id")
        .eq("family_id", parent.family_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const player = playerRow.data as { id: string } | null;
      if (player) {
        const subUpdate = await supabase
          .from("subscriptions")
          .update({
            trial_call_event_uri: eventUri,
            trial_call_at: startIso,
            lifecycle_state: "TRIAL_SCHEDULED",
            // waiting_on stays SYSTEM until the call ends; the view does
            // the lazy time-based transition for surfacing as TIM-task.
            waiting_on: "SYSTEM",
          } as never)
          .eq("player_id", player.id);
        if (subUpdate.error) {
          console.error("[calendly-webhook] subscription substate update failed", subUpdate.error);
          // Non-fatal — confirmation email still sends.
        }
      }
    }
  } catch (err) {
    console.error("[calendly-webhook] subscription substate update threw", err);
  }

  const parentFirstName =
    payload.first_name?.trim() ||
    payload.name?.split(" ")[0]?.trim() ||
    "there";

  // Q&A order from Calendly setup is fixed in the event type definition.
  // Calendly numbers positions 0-indexed in the webhook payload:
  //   0: kid first name, 1: kid Discord, 2: kid Fortnite IGN,
  //   3: kid age, 4: what they want to get better at (optional)
  // We match by position to avoid breakage if the question label is edited.
  const qa = payload.questions_and_answers ?? [];
  const findByPos = (n: number) =>
    qa.find((row) => row.position === n)?.answer?.trim() || null;
  const kidFirstName = findByPos(0);
  const kidDiscord = findByPos(1);

  const tz = payload.timezone || "America/Los_Angeles";
  const startDate = new Date(startIso);
  const fullDate = formatFullDate(startDate, tz); // "Saturday, May 23, 2026"
  const subjectDate = formatSubjectDate(startDate, tz); // "Saturday, May 23"
  const timeStr = formatTime(startDate, tz); // "2:30pm PT"

  const subject = `You're booked. See you ${subjectDate}.`;
  const html = bookingConfirmationHtml({
    parentFirstName,
    kidFirstName,
    fullDate,
    timeStr,
    kidDiscord,
  });

  try {
    await resend.emails.send({
      from: `XPL Keyed <${FROM_EMAIL.replace(/^.*<|>$/g, "")}>`,
      to: parentEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error("[calendly-webhook] confirmation send failed", err);
  }
}

// ---------------------------------------------------------------------------
// invitee.created — PAID LESSON
// ---------------------------------------------------------------------------
// Phase 2 of the conversion flow. Parent has approved the curriculum
// and is booking the 4 weekly sessions through /portal/sessions. Each
// Calendly booking fires this handler.
//
// Wire-up:
//   1. Resolve parent email -> family -> player -> pending curriculum
//      -> next pending slot (lowest week_number with live_call_at IS NULL).
//   2. Write live_call_at + live_call_event_id to that slot.
//   3. If this is slot 1, set curricula.cycle_anchor_at = startIso.
//   4. Count booked slots after the write. 4 -> PENDING_PAYMENT; else
//      SCHEDULING_IN_PROGRESS.
//   5. Send a confirmation email in Tim's voice with the booked time.

async function handlePaidLessonCreated(
  payload: InviteePayload,
  supabase: Supa,
  startIso: string,
  parentEmail: string,
  eventUri: string | null,
) {
  const parentRow = await supabase
    .from("parents")
    .select("family_id, first_name, email")
    .ilike("email", parentEmail)
    .maybeSingle();
  const parent = parentRow.data as
    | { family_id: string; first_name: string; email: string }
    | null;
  if (!parent) {
    console.warn("[calendly-webhook][paid] no parent for", parentEmail);
    return;
  }

  const playerRow = await supabase
    .from("players")
    .select("id, first_name")
    .eq("family_id", parent.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const player = playerRow.data as { id: string; first_name: string } | null;
  if (!player) {
    console.warn("[calendly-webhook][paid] no player for family", parent.family_id);
    return;
  }

  const curriculumRow = await supabase
    .from("curricula")
    .select("id, cycle_anchor_at")
    .eq("player_id", player.id)
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curriculum = curriculumRow.data as
    | { id: string; cycle_anchor_at: string | null }
    | null;
  if (!curriculum) {
    console.warn("[calendly-webhook][paid] no pending curriculum for player", player.id);
    return;
  }

  // Find next pending slot.
  const slotRow = await supabase
    .from("curriculum_slots")
    .select("id, week_number")
    .eq("curriculum_id", curriculum.id)
    .is("live_call_at", null)
    .order("week_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  const slot = slotRow.data as { id: string; week_number: number } | null;
  if (!slot) {
    console.warn("[calendly-webhook][paid] no pending slot for curriculum", curriculum.id);
    return;
  }

  // Write the slot.
  const slotUpdate = await supabase
    .from("curriculum_slots")
    .update({
      live_call_at: startIso,
      live_call_event_id: eventUri,
    } as never)
    .eq("id", slot.id);
  if (slotUpdate.error) {
    console.error("[calendly-webhook][paid] slot update failed", slotUpdate.error);
    return;
  }

  // If this is Week 1, anchor the cycle.
  if (slot.week_number === 1 && !curriculum.cycle_anchor_at) {
    const curriculumUpdate = await supabase
      .from("curricula")
      .update({ cycle_anchor_at: startIso } as never)
      .eq("id", curriculum.id);
    if (curriculumUpdate.error) {
      console.error("[calendly-webhook][paid] cycle_anchor_at write failed", curriculumUpdate.error);
    }
  }

  // Count booked slots and advance lifecycle.
  const allSlotsRow = await supabase
    .from("curriculum_slots")
    .select("id, live_call_at")
    .eq("curriculum_id", curriculum.id);
  const allSlots = (allSlotsRow.data ?? []) as Array<{ live_call_at: string | null }>;
  const bookedCount = allSlots.filter((s) => s.live_call_at).length;
  const totalSlots = allSlots.length;

  let nextLifecycle: "SCHEDULING_IN_PROGRESS" | "PENDING_PAYMENT" =
    "SCHEDULING_IN_PROGRESS";
  const updatePatch: Record<string, unknown> = {
    lifecycle_state: nextLifecycle,
    waiting_on: "PARENT",
  };
  if (bookedCount >= totalSlots) {
    nextLifecycle = "PENDING_PAYMENT";
    updatePatch.lifecycle_state = nextLifecycle;
    updatePatch.payment_pending_at = new Date().toISOString();
  }

  const subUpdate = await supabase
    .from("subscriptions")
    .update(updatePatch as never)
    .eq("player_id", player.id);
  if (subUpdate.error) {
    console.error("[calendly-webhook][paid] subscription lifecycle update failed", subUpdate.error);
  }

  // Confirmation email in Tim's voice.
  const tz = payload.timezone || "America/Los_Angeles";
  const startDate = new Date(startIso);
  const fullDate = formatFullDate(startDate, tz);
  const timeStr = formatTime(startDate, tz);
  const remaining = totalSlots - bookedCount;
  const closingLine =
    remaining > 0
      ? `<p>Reserve Week ${slot.week_number + 1} when you have a minute. ${remaining} session${remaining === 1 ? "" : "s"} left to lock in.</p>`
      : `<p>All four sessions are reserved. Last step is the $56 first-cycle charge in your dashboard. Once that lands the portal lights up for ${player.first_name}.</p>`;
  const html = brandedEmailHtml({
    headline: `Week ${slot.week_number} reserved`,
    bodyHtml: `<p>Hi ${parent.first_name},</p>
<p>Week ${slot.week_number} of ${totalSlots} is on the calendar for ${player.first_name}: ${fullDate} at ${timeStr}. The call happens on Discord.</p>
${closingLine}
<p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
    ctaLabel: bookedCount >= totalSlots ? "Complete checkout" : "Open dashboard",
    ctaHref: `${APP_URL}/portal/sessions`,
  });
  try {
    await resend.emails.send({
      from: `XPL Keyed <${FROM_EMAIL.replace(/^.*<|>$/g, "")}>`,
      to: parent.email,
      subject: `${player.first_name}'s Week ${slot.week_number} is set`,
      html,
    });
  } catch (err) {
    console.error("[calendly-webhook][paid] confirmation send failed", err);
  }
}

function formatFullDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz,
  }).format(date);
}

function formatSubjectDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  }).format(date);
}

// "2:30pm PT". Lower-cases AM/PM, removes the space before it, and strips
// the daylight/standard distinction from US-zone abbreviations (PDT -> PT,
// EST -> ET, CDT -> CT, etc). Non-US zones keep whatever Intl renders.
function formatTime(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour ?? "";
  const minute = map.minute ?? "00";
  const dayPeriod = (map.dayPeriod ?? "").toLowerCase();
  let zone = map.timeZoneName ?? "";
  // PDT -> PT, EST -> ET, etc. Single-letter prefix + DT/ST suffix.
  zone = zone.replace(/^([PMECAH])[DS]T$/, "$1T");
  return `${hour}:${minute}${dayPeriod} ${zone}`.trim();
}

function bookingConfirmationHtml(args: {
  parentFirstName: string;
  kidFirstName: string | null;
  fullDate: string;
  timeStr: string;
  kidDiscord: string | null;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Two parent-facing references to the kid in the "What happens next"
  // sentence: the kid's first name for the possessive, and the Discord
  // username in parens so the parent can verify Tim's invite lands on
  // the right handle.
  const kidPossessive = args.kidFirstName ? `${esc(args.kidFirstName)}'s` : "your child's";
  const discordParen = args.kidDiscord ? ` (${esc(args.kidDiscord)})` : "";
  // Lead with the kid's name when we have it; otherwise fall back to a
  // generic phrasing rather than "you" since the call is for the kid,
  // not the parent.
  const subject = args.kidFirstName
    ? `${esc(args.kidFirstName)} is`
    : "Your kid is";

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0B1538;color:#fff;font-family:Inter,system-ui,sans-serif;line-height:1.55;">
<div style="max-width:560px;margin:0 auto;background:#0F1B47;border-radius:12px;padding:32px;">
<h1 style="font-family:'Anton',Impact,sans-serif;font-size:28px;letter-spacing:1px;margin:0 0 16px;color:#C7FF3D;">You're booked</h1>
<div style="font-size:15px;color:rgba(255,255,255,0.92);">
<p>Hi ${esc(args.parentFirstName)},</p>
<p>${subject} all set for our 30 minute free intro call.</p>
<p>
  <strong>When:</strong> ${esc(args.fullDate)} at ${esc(args.timeStr)}<br/>
  <strong>Where:</strong> Discord (XPL Keyed coaching server)
</p>
<p><strong>What happens next:</strong> in the next day or so, be sure to accept the Discord invite I'll send to ${kidPossessive} username${discordParen}. That's where the call will happen.</p>
<p><strong>A few reminders:</strong></p>
<ul style="padding-left:20px;margin:8px 0;">
  <li>Parents are welcome to listen in on the first call and ask questions at the end.</li>
  <li>I never call or text your phone.</li>
  <li>No payment info needed today.</li>
</ul>
<p>Questions? Sign in to your XPL Keyed dashboard and message me in the Messages panel. I see it on my end and reply there. Otherwise, see you ${esc(args.fullDate.split(",")[0])}.</p>
<p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>
<p style="margin-top:24px;font-size:13px;color:rgba(255,255,255,0.6);border-top:1px solid rgba(255,255,255,0.12);padding-top:16px;">Need to come back later? Sign in any time at <a href="${APP_URL}/login" style="color:#C7FF3D;">${APP_URL.replace(/^https?:\/\//, "")}/login</a>.</p>
</div>
<p style="margin-top:32px;font-size:12px;color:rgba(255,255,255,0.5);">XPL Keyed. Independent Fortnite coaching.</p>
</div>
</body></html>`;
}


// ---------------------------------------------------------------------------
// Coach (Tim) cancels that come through Calendly directly. The admin UI's
// [Coach cancel] button writes coach_cancels rows directly; we still need to
// handle the case where Tim hits Calendly's cancel link manually.
// ---------------------------------------------------------------------------

async function applyCoachCancel(slot: SlotRow, supabase: Supa) {
  const nowIso = new Date().toISOString();
  // We do not know the coach_id from the webhook payload alone; in the
  // single-coach MVP we look up Tim's row. Multi-coach support would need
  // canceler.email -> coaches lookup.
  const { data: coach } = await supabase.from("coaches").select("id").limit(1).maybeSingle();
  if (!coach) return;

  const { error } = await supabase.from("coach_cancels").insert({
    coach_id: coach.id,
    curriculum_slot_id: slot.id,
    scope: "individual",
    reason: "Calendly direct cancel",
    bypassed_24hr_gate: true,
  });
  if (error) throw error;

  // Per CLAUDE.md: coach cancels pause the family's cycle 1 week, no cap
  // impact, no cycle_lessons_delivered increment. Mark the slot delivered_at
  // so the Sunday cron skips it; the next Sunday picks up the next slot.
  await supabase.from("curriculum_slots").update({ delivered_at: nowIso }).eq("id", slot.id);
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

type SlotRow = {
  id: string;
  live_call_at: string | null;
  subscription_id: string;
};

async function fetchSlotByEventUri(eventUri: string, supabase: Supa): Promise<SlotRow | null> {
  // curriculum_slots stores the Calendly event URI in live_call_event_id.
  // We also need the subscription id, which requires chaining
  // curriculum_slots -> curricula(player_id) -> subscriptions(player_id).
  const { data, error } = await supabase
    .from("curriculum_slots")
    .select("id, live_call_at, curriculum:curricula(player_id)")
    .eq("live_call_event_id", eventUri)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const playerId = (data.curriculum as unknown as { player_id: string } | null)?.player_id;
  if (!playerId) return null;

  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("player_id", playerId)
    .maybeSingle();
  if (subErr) throw subErr;
  if (!sub) return null;

  return {
    id: data.id,
    live_call_at: data.live_call_at,
    subscription_id: sub.id,
  };
}

type SubscriptionRow = {
  id: string;
  player_id: string;
  status: string;
  stripe_subscription_id: string | null;
  cycle_cancels_used: number;
  cycle_skips_used: number;
  cycle_lessons_delivered: number;
  auto_renew_enabled: boolean;
};

async function fetchSubscriptionForSlot(
  subscriptionId: string,
  supabase: Supa,
): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, player_id, status, stripe_subscription_id, cycle_cancels_used, cycle_skips_used, cycle_lessons_delivered, auto_renew_enabled",
    )
    .eq("id", subscriptionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Side effects: parent email + Tim Discord ping
// ---------------------------------------------------------------------------

async function notifyParent(args: {
  subscription: SubscriptionRow;
  classification: "credit" | "forfeit";
  triggeredPendingCancel: boolean;
}) {
  const { subscription, classification, triggeredPendingCancel } = args;
  if (!process.env.RESEND_API_KEY) return;

  // Look up parent email. Hand-rolled inline query because resend lives in
  // a separate lib and we don't have a shared "parent for subscription" helper yet.
  const supabase = createServiceRoleClient();
  const { data: player } = await supabase
    .from("players")
    .select("first_name, family_id")
    .eq("id", subscription.player_id)
    .maybeSingle();
  if (!player) return;

  const { data: parent } = await supabase
    .from("parents")
    .select("email, first_name")
    .eq("family_id", player.family_id)
    .maybeSingle();
  if (!parent) return;

  let subject: string;
  let body: string;

  if (triggeredPendingCancel) {
    subject = `Confirming the end of ${player.first_name}'s coaching`;
    body = pendingCancelEmail(player.first_name, parent.first_name);
  } else if (classification === "credit") {
    subject = `${player.first_name}'s lesson is rescheduled`;
    body = creditEmail(player.first_name, parent.first_name);
  } else {
    subject = `${player.first_name}'s lesson materials are ready`;
    body = forfeitEmail(player.first_name, parent.first_name);
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: parent.email,
      subject,
      html: body,
    });
  } catch (err) {
    console.error("[calendly-webhook] resend send failed", err);
  }
}

async function notifyTimCancelThird(subscription: SubscriptionRow, supabase: Supa) {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_TIM_USER_ID) return;

  const { data: player } = await supabase
    .from("players")
    .select("first_name")
    .eq("id", subscription.player_id)
    .maybeSingle();
  const name = player?.first_name ?? "a family";

  // Mark idempotency so the cancel-#3 cron / future runs don't double-ping.
  await supabase
    .from("subscriptions")
    .update({ notified_at_third_cancel: new Date().toISOString() })
    .eq("id", subscription.id);

  try {
    await sendDirectMessage(
      process.env.DISCORD_TIM_USER_ID,
      `${name}'s family just hit cancel 3 of 3. Subscription is in pending_cancel for 7 days. Want to reach out before it auto confirms?`,
    );
  } catch (err) {
    console.error("[calendly-webhook] discord DM failed", err);
  }
}

// ---------------------------------------------------------------------------
// Email shells. Real branded HTML will replace these; copy here is the
// minimum viable parent-facing voice and is dash-free per Hard rule #8.
// ---------------------------------------------------------------------------

function creditEmail(kid: string, parent: string): string {
  return `<p>Hi ${parent},</p>
<p>${kid}'s lesson this week is on hold. The cycle pauses one week and picks up where we left off next Sunday. No charge, no impact on next week.</p>
<p>Tim</p>`;
}

function forfeitEmail(kid: string, parent: string): string {
  return `<p>Hi ${parent},</p>
<p>${kid} will still get this week's lesson materials. The live call portion is forfeit since the cancel came under the 24 hour window, but ${kid} keeps the slides and voiceover and the cycle continues as usual.</p>
<p>Tim</p>`;
}

function pendingCancelEmail(kid: string, parent: string): string {
  const confirmUrl = `${APP_URL}/billing/end?confirm=1`;
  const undoUrl = `${APP_URL}/billing/end?undo=1`;
  return `<p>Hi ${parent},</p>
<p>${kid}'s third cancellation this cycle has come through. Kids who skip more than two lessons in a cycle don't see meaningful progress, so the subscription is paused while you decide.</p>
<p>No new charges and no new lessons for the next 7 days. After that, the subscription ends automatically unless you tell us to keep it.</p>
<p><a href="${confirmUrl}">Confirm end subscription</a> &nbsp;&nbsp; <a href="${undoUrl}">Undo cancel and keep going</a></p>
<p>Tim</p>`;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

// Calendly's signature header format:
//   t=<unix_seconds>,v1=<hex_hmac_sha256(secret, `${t}.${rawBody}`)>
// Reject if timestamp is older than SIGNATURE_TOLERANCE_SECONDS so an
// intercepted payload can't be replayed indefinitely.
function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    parts[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Payload types. Calendly's API has evolved; treat these as best-effort and
// rely on optional chaining.
// ---------------------------------------------------------------------------

type CalendlyWebhookBody = {
  event: string;
  payload: InviteePayload;
};

type InviteePayload = {
  // Scheduled-event URI. Older webhook versions used `event`, newer wrap it
  // as `scheduled_event.uri`. Check both.
  event?: string;
  scheduled_event?: {
    uri: string;
    // Event type URI (e.g., https://api.calendly.com/event_types/<id>).
    // Used to discriminate intro-call vs paid-lesson invitee.created.
    event_type?: string;
    // Event type display name (e.g., "Paid lesson 30 min"). Fallback
    // discriminator when event_type URI isn't matched by env config.
    name?: string;
    start_time?: string;
    end_time?: string;
  };
  rescheduled?: boolean;
  // Reschedule chain: new booking sets this; reschedule of a trial call
  // means the user already got our branded email at the initial booking.
  rescheduled_from?: { uri: string } | null;
  old_invitee?: { uri: string } | null;
  cancellation?: {
    canceler_type?: "host" | "invitee";
    reason?: string;
  };
  // invitee.created fields (not present on cancel)
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  timezone?: string;
  cancel_url?: string;
  reschedule_url?: string;
  questions_and_answers?: Array<{
    position?: number;
    question?: string;
    answer?: string;
  }>;
};
