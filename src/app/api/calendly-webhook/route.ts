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
        await handleInviteeCreated(body.payload);
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

  let cycleCancelsUsedAfter = subscription.cycle_cancels_used;
  let cycleLessonsDeliveredAfter = subscription.cycle_lessons_delivered;
  let triggeredPendingCancel = false;

  if (classification === "credit") {
    cycleCancelsUsedAfter = subscription.cycle_cancels_used + 1;
    // cycle_lessons_delivered stays put; the lesson is credited back.
  } else {
    // Forfeit: the lesson counts as delivered (kid keeps materials), cycle
    // advances, cap is NOT incremented.
    cycleLessonsDeliveredAfter = subscription.cycle_lessons_delivered + 1;
  }

  // Per CLAUDE.md: 3rd CREDIT in a cycle triggers pending_cancel. Forfeits
  // don't move the cap, so they never trigger pending_cancel.
  if (classification === "credit" && cycleCancelsUsedAfter >= 3) {
    triggeredPendingCancel = true;
  }

  // Subscription update
  const { error: subErr } = await supabase
    .from("subscriptions")
    .update(
      triggeredPendingCancel
        ? {
            last_cancel_at: nowIso,
            cycle_cancels_used: cycleCancelsUsedAfter,
            cycle_lessons_delivered: cycleLessonsDeliveredAfter,
            status: "pending_cancel",
            lifecycle_state: "PENDING_CANCEL",
            // waiting_on='PARENT' per backend-spec section 2 "Reschedule
            // / cancel requests": 3rd credit triggers pending_cancel,
            // parent now confirms or undoes during the 7-day window.
            waiting_on: "PARENT",
            pending_cancel_started_at: nowIso,
            pending_cancel_auto_confirm_at: new Date(
              Date.now() + PENDING_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
            ).toISOString(),
          }
        : {
            last_cancel_at: nowIso,
            cycle_cancels_used: cycleCancelsUsedAfter,
            cycle_lessons_delivered: cycleLessonsDeliveredAfter,
          },
    )
    .eq("id", subscription.id);
  if (subErr) throw subErr;

  // Audit row. waiting_on='SYSTEM' because our handler auto-classifies
  // credit vs forfeit per the 24hr rule; Tim does not currently review.
  // Backend-spec section 2 envisions a "Tim reviews credit" flow that
  // would set waiting_on='TIM' here instead; not built yet.
  const { error: evErr } = await supabase.from("cancellation_events").insert({
    subscription_id: subscription.id,
    curriculum_slot_id: slot.id,
    initiated_via: "calendly_link",
    hours_until_call: hoursUntilCall,
    classification,
    cycle_cancels_used_after: cycleCancelsUsedAfter,
    triggered_pending_cancel: triggeredPendingCancel,
    waiting_on: "SYSTEM",
  });
  if (evErr) throw evErr;

  // Mark the slot as cancelled so the Sunday cron doesn't ship it again.
  // The cycle field is the source of truth for "did the lesson land"; this
  // slot still belongs to the curriculum even when forfeited.
  if (classification === "forfeit") {
    await supabase
      .from("curriculum_slots")
      .update({ delivered_at: nowIso })
      .eq("id", slot.id);
  }

  // Pause Stripe billing immediately on pending_cancel so we don't charge the
  // parent during the 7-day undo window.
  if (triggeredPendingCancel && subscription.stripe_subscription_id) {
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  }

  // Side effects: email parent, optionally DM Tim
  await notifyParent({ subscription, classification, triggeredPendingCancel });
  if (triggeredPendingCancel) {
    await notifyTimCancelThird(subscription, supabase);
  }
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

async function handleInviteeCreated(payload: InviteePayload) {
  const startIso = payload.scheduled_event?.start_time;
  const parentEmail = payload.email;
  if (!startIso || !parentEmail) {
    console.warn("[calendly-webhook] invitee.created missing start_time or email", {
      hasStart: !!startIso,
      hasEmail: !!parentEmail,
    });
    return;
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
<p>${subject} all set for a 30 minute free intro call with Tim.</p>
<p>
  <strong>When:</strong> ${esc(args.fullDate)} at ${esc(args.timeStr)}<br/>
  <strong>Where:</strong> Discord (XPL Keyed coaching server)
</p>
<p><strong>What happens next:</strong> in the next day or so, be sure to accept the invite Tim will send to ${kidPossessive} Discord username${discordParen}. That's where the call will happen.</p>
<p><strong>A few reminders:</strong></p>
<ul style="padding-left:20px;margin:8px 0;">
  <li>Parents are welcome to listen in on the first call and ask questions at the end.</li>
  <li>Tim never calls or texts your phone.</li>
  <li>No payment info needed today.</li>
</ul>
<p>Questions? Sign in to your XPL Keyed dashboard and message Tim in the Messages panel. Tim sees it and replies there. Otherwise, see you ${esc(args.fullDate.split(",")[0])}.</p>
<p style="margin-top:24px;">Peter<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">(Tim's dad, who runs the back end of XPL Keyed)</span></p>
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
  cycle_lessons_delivered: number;
};

async function fetchSubscriptionForSlot(
  subscriptionId: string,
  supabase: Supa,
): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, player_id, status, stripe_subscription_id, cycle_cancels_used, cycle_lessons_delivered",
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
