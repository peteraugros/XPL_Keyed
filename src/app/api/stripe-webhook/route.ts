// Stripe webhook handler. Wired up locally via:
//   stripe listen --forward-to localhost:3000/api/stripe-webhook
// and in prod by a webhook endpoint configured in the Stripe dashboard
// (its signing secret goes in STRIPE_WEBHOOK_SECRET).
//
// Handles four events:
//   - invoice.payment_failed       → mark subscription past_due (Day 0 dunning)
//   - invoice.paid                 → start a fresh 4-lesson cycle
//   - customer.subscription.updated → sync status, preserving our pending_cancel state
//   - customer.subscription.deleted → mark canceled
//
// Idempotency is intentionally minimal for MVP — Stripe only retries on
// non-2xx responses, and re-applying any of these state transitions on the
// same row is safe (set status='active' twice, reset counters to 0 twice, etc).
// The one minor edge: cycle_started_at can shift forward by seconds if Stripe
// retries an invoice.paid. Track-by-event-id can be layered in later.

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

type Supa = ReturnType<typeof createServiceRoleClient>;

export async function POST(req: Request) {
  if (!WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, supabase);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, supabase);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice, supabase);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, supabase);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, supabase);
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, supabase);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, supabase);
        break;
      default:
        // Stripe sends many event types we don't care about. Acknowledge with 200
        // so it doesn't retry, but don't run any handler.
        break;
    }
  } catch (err) {
    console.error("[stripe-webhook]", event.type, event.id, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true, type: event.type });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// checkout.session.completed — fires after the parent finishes the
// /curriculum/[token] payment flow. Source of truth for "Stage C
// conversion paid." Flips:
//   * curricula.status='active', approved_at=NOW()
//   * subscriptions.tier='monthly', status='active',
//     cycle_started_at=NOW(), cycle_lessons_delivered=0, cycle_cancels_used=0
//
// Identifies the rows via session.metadata that the checkout endpoint
// stashed: curriculum_id + subscription_id. Both are looked up by id
// against the service-role client (RLS-bypassing), so RLS layout doesn't
// matter here.
//
// Idempotency: if the curriculum is already active (webhook fires twice,
// or the redirect-then-webhook race lands the user first), the update
// is a no-op since the WHERE filter is by id + the patch matches the
// existing state.
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabase: Supa,
) {
  if (session.payment_status !== "paid") return;
  const meta = session.metadata ?? {};
  const kind = meta.kind;
  const curriculumId = meta.curriculum_id;
  const subscriptionId = meta.subscription_id;
  if (!curriculumId || !subscriptionId) {
    console.warn("[stripe-webhook] checkout.session.completed missing metadata", {
      kind,
      hasCurriculum: !!curriculumId,
      hasSubscription: !!subscriptionId,
    });
    return;
  }

  // Single coaching session ($24 one-off) has its own activation path —
  // no cycle counters, no welcome task, no auto-renew. Parent goes
  // straight to scheduling via /portal/sessions.
  if (kind === "single_session") {
    await activateSingleSessionAfterPayment(
      supabase,
      curriculumId,
      subscriptionId,
    );
    return;
  }

  if (kind !== "first_cycle") {
    console.warn("[stripe-webhook] unknown checkout.session.completed kind", kind);
    return;
  }

  // Flip the curriculum row. waiting_on transitions from PARENT to
  // SYSTEM per backend-spec section 2 (Stripe activates → no human turn).
  const curriculumUpdate = await supabase
    .from("curricula")
    .update({
      status: "active",
      approved_at: new Date().toISOString(),
      waiting_on: "SYSTEM",
    } as never)
    .eq("id", curriculumId);
  if (curriculumUpdate.error) {
    console.error("[stripe-webhook] curriculum update failed", curriculumUpdate.error);
    throw new Error("curriculum_update_failed");
  }

  // Flip the subscription row. cycle counters reset; status flips to active.
  // stripe_subscription_id stays null in this MVP flow because we're using a
  // one-time payment with off-session card save, not a Stripe Subscription
  // object. Future cycles fire via PaymentIntents from our cron, not Stripe's
  // recurring billing. (Spec: "manually-advanced cycle" — see CLAUDE.md.)
  const paidAt = new Date();
  // waiting_on=TIM here surfaces the new_student_welcome task on
  // Focused Home so Tim sees the conversion. The welcome endpoint
  // flips it back to SYSTEM when Tim taps "I welcomed them".
  const subscriptionUpdate = await supabase
    .from("subscriptions")
    .update({
      tier: "monthly",
      status: "active",
      lifecycle_state: "ACTIVE",
      waiting_on: "TIM",
      cycle_started_at: paidAt.toISOString(),
      cycle_lessons_delivered: 0,
      cycle_cancels_used: 0,
      past_due_started_at: null,
      notified_at_day7_dunning: null,
      welcomed_at: null,
      coach_seen_at: null,
    } as never)
    .eq("id", subscriptionId);
  if (subscriptionUpdate.error) {
    console.error("[stripe-webhook] subscription update failed", subscriptionUpdate.error);
    throw new Error("subscription_update_failed");
  }

  // Decide whether Week 1 needs immediate delivery. Rule (per Peter,
  // 2026-05-19): deliver immediately if there is NO Sunday between
  // today and Week 1's live call. Otherwise wait for the Sunday cron.
  // Defensive: if anything in this branch fails, we log + continue —
  // the Sunday cron will catch the slot on its next run.
  try {
    const week1Resp = await supabase
      .from("curriculum_slots")
      .select("id, live_call_at")
      .eq("curriculum_id", curriculumId)
      .eq("week_number", 1)
      .maybeSingle();
    const week1 = week1Resp.data as { id: string; live_call_at: string | null } | null;
    if (week1?.live_call_at) {
      const { shouldDeliverWeek1Immediately } = await import("@/lib/lessons/timing");
      if (shouldDeliverWeek1Immediately(paidAt, new Date(week1.live_call_at))) {
        const { deliverWeekOneImmediately } = await import("@/lib/lessons/deliver-week-one");
        const result = await deliverWeekOneImmediately(subscriptionId);
        if (!result.ok) {
          console.warn("[stripe-webhook] immediate week-1 delivery skipped:", result.reason);
        }
      }
    }
  } catch (err) {
    console.error("[stripe-webhook] immediate-delivery branch threw", err);
  }
}

// $24 single coaching session activation. Mirrors the relevant subset
// of handleCheckoutSessionCompleted's "first_cycle" branch but:
//   * tier stays 'single' (set at submit time, not flipped to 'monthly').
//   * lifecycle PENDING_PAYMENT → SCHEDULING_IN_PROGRESS so the parent
//     lands in /portal/sessions and the SchedulerWizard offers the
//     single slot. waiting_on=PARENT for the same reason.
//   * scheduling_started_at stamped so the parent_started_scheduling
//     task surfaces on Tim's Focused Home.
//   * cycle_started_at deliberately NOT set — keeps cycle_drag_out
//     (and any future cycle-counter logic) from firing for this
//     subscription type. Single-session does not have a "cycle."
//   * payment_pending_at cleared.
//   * No new_student_welcome task — single-session doesn't onboard.
//   * No Sunday-cron auto-delivery prep — slides ship after the call
//     is marked complete (or at slot live_call_at time, whichever
//     pattern the existing delivery cron uses).
async function activateSingleSessionAfterPayment(
  supabase: Supa,
  curriculumId: string,
  subscriptionId: string,
) {
  const curriculumUpdate = await supabase
    .from("curricula")
    .update({
      status: "active",
      approved_at: new Date().toISOString(),
      waiting_on: "SYSTEM",
    } as never)
    .eq("id", curriculumId);
  if (curriculumUpdate.error) {
    console.error(
      "[stripe-webhook] single-session curriculum update failed",
      curriculumUpdate.error,
    );
    throw new Error("curriculum_update_failed");
  }

  // In the new pre-pay-schedule flow the slot is already booked by the
  // time this fires (Calendly webhook ran first). lifecycle goes
  // straight to ACTIVE, waiting_on flips to TIM (he runs the call
  // next), and payment_pending_at clears so the abandonment cron
  // stops watching this row.
  const subscriptionUpdate = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      lifecycle_state: "ACTIVE",
      waiting_on: "TIM",
      payment_pending_at: null,
    } as never)
    .eq("id", subscriptionId);
  if (subscriptionUpdate.error) {
    console.error(
      "[stripe-webhook] single-session subscription update failed",
      subscriptionUpdate.error,
    );
    throw new Error("subscription_update_failed");
  }

  // Send the "payment received, you're locked in" magic-link email.
  // Different copy from the old "now schedule" email — by this point
  // the parent has already picked the time. Fire-and-log; failure is
  // recoverable (parent can sign in to /portal manually).
  try {
    const { sendSingleSessionPaidEmail } = await import(
      "@/lib/lessons/single-session-email"
    );
    await sendSingleSessionPaidEmail(subscriptionId);
  } catch (err) {
    console.error(
      "[stripe-webhook] single-session paid-email branch threw",
      err,
    );
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, supabase: Supa) {
  const stripeSubId = subscriptionIdFromInvoice(invoice);
  if (!stripeSubId) return;

  const { data: existing, error: fetchErr } = await supabase
    .from("subscriptions")
    .select("id, status, past_due_started_at")
    .eq("stripe_subscription_id", stripeSubId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) return;

  // pending_cancel uses cancel_at_period_end → Stripe shouldn't bill while in
  // that state. If we somehow get a payment_failed event for one, leave it.
  if (existing.status === "pending_cancel" || existing.status === "canceled") return;

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "past_due",
      lifecycle_state: "PAST_DUE",
      // waiting_on stays SYSTEM until day-6 dunning cron flips it to TIM
      // per backend-spec section 2 "Dunning" table.
      // Preserve original Day 0 across retried events so the dunning clock
      // (cron-day7-dunning-ping, cron-dunning-parent-reminders) stays anchored.
      past_due_started_at: existing.past_due_started_at ?? nowIso,
    })
    .eq("id", existing.id);
  if (error) throw error;
}

async function handleInvoicePaid(invoice: Stripe.Invoice, supabase: Supa) {
  const stripeSubId = subscriptionIdFromInvoice(invoice);
  if (!stripeSubId) return;

  // Only reset cycle state on actual subscription invoices (initial charge
  // or renewal). Manual / proration / one-off invoices shouldn't reset.
  const reason = (invoice as { billing_reason?: string | null }).billing_reason;
  if (reason !== "subscription_create" && reason !== "subscription_cycle") return;

  const { data: existing, error: fetchErr } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", stripeSubId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) return;

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      lifecycle_state: "ACTIVE",
      waiting_on: "SYSTEM",
      cycle_started_at: nowIso,
      cycle_lessons_delivered: 0,
      cycle_cancels_used: 0,
      past_due_started_at: null,
      notified_at_day7_dunning: null,
    })
    .eq("id", existing.id);
  if (error) throw error;
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription, supabase: Supa) {
  const { data: existing, error: fetchErr } = await supabase
    .from("subscriptions")
    .select("id, status")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) return;

  // pending_cancel is our internal state (cancel #3 awaiting parent confirmation).
  // Stripe doesn't know about it. The only transition allowed from Stripe is
  // pending_cancel → canceled when the period actually ends.
  if (existing.status === "pending_cancel" && sub.status !== "canceled") return;

  const mapped = mapStripeStatus(sub.status);
  if (!mapped || mapped === existing.status) return;

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: mapped })
    .eq("id", existing.id);
  if (error) throw error;
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription, supabase: Supa) {
  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("stripe_subscription_id", sub.id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Stripe's Invoice shape moved subscription from a top-level field to
// invoice.parent.subscription_details.subscription in newer API versions.
// Check both so this handler keeps working across API upgrades.
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as unknown as { subscription?: string | { id: string } | null })
    .subscription;
  if (direct) return typeof direct === "string" ? direct : direct.id;

  const nested = (
    invoice as unknown as {
      parent?: { subscription_details?: { subscription?: string | { id: string } | null } };
    }
  ).parent?.subscription_details?.subscription;
  if (nested) return typeof nested === "string" ? nested : nested.id;

  return null;
}

function mapStripeStatus(
  s: Stripe.Subscription.Status,
): "active" | "past_due" | "canceled" | null {
  switch (s) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    case "paused":
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// PaymentIntent handlers — off-session renewal charges
// ---------------------------------------------------------------------------
// The cron-auto-renew-detection cron fires PaymentIntents with
// metadata.kind='renewal' and metadata.subscription_id=<id>. On
// success we provision the next cycle. On failure the subscription
// drops to PAST_DUE (same as the existing dunning path).

async function handlePaymentIntentSucceeded(
  pi: Stripe.PaymentIntent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const kind = pi.metadata?.kind;
  if (kind !== "renewal") {
    // Not ours to handle; first-cycle payments are settled through
    // checkout.session.completed.
    return;
  }
  const subscriptionId = pi.metadata?.subscription_id;
  if (!subscriptionId) {
    console.warn("[stripe-webhook] renewal PI missing subscription_id", pi.id);
    return;
  }

  // Provision the next cycle. Dynamic-import the helper to avoid pulling
  // node:crypto into the top-level module graph until needed.
  const { provisionNextCycle } = await import("@/lib/lessons/auto-renew");
  try {
    await provisionNextCycle({ supabase, subscriptionId });
  } catch (err) {
    console.error("[stripe-webhook][renewal] provision failed", subscriptionId, err);
    throw err;
  }

  // Clear the renewal-in-flight marker so the NEXT cycle's renewal can
  // fire when this newly-provisioned cycle eventually completes.
  await supabase
    .from("subscriptions")
    .update({ renewal_pi_id: null } as never)
    .eq("id", subscriptionId);
}

async function handlePaymentIntentFailed(
  pi: Stripe.PaymentIntent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const kind = pi.metadata?.kind;
  if (kind !== "renewal") return;
  const subscriptionId = pi.metadata?.subscription_id;
  if (!subscriptionId) return;

  // Flip lifecycle into PAST_DUE. The existing dunning crons take it
  // from here (Day-3, Day-6 reminders, Day-7 auto-cancel). Also clear
  // the renewal marker so the cron retries on the next sweep when the
  // parent updates their card.
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "past_due",
      lifecycle_state: "PAST_DUE",
      past_due_started_at: nowIso,
      renewal_pi_id: null,
    } as never)
    .eq("id", subscriptionId);
  if (error) {
    console.error("[stripe-webhook][renewal] PAST_DUE update failed", error);
  }
}
