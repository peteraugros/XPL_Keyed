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
  if (kind !== "first_cycle" || !curriculumId || !subscriptionId) {
    console.warn("[stripe-webhook] checkout.session.completed missing metadata", {
      kind,
      hasCurriculum: !!curriculumId,
      hasSubscription: !!subscriptionId,
    });
    return;
  }

  // Flip the curriculum row.
  const curriculumUpdate = await supabase
    .from("curricula")
    .update({
      status: "active",
      approved_at: new Date().toISOString(),
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
  const subscriptionUpdate = await supabase
    .from("subscriptions")
    .update({
      tier: "monthly",
      status: "active",
      cycle_started_at: new Date().toISOString(),
      cycle_lessons_delivered: 0,
      cycle_cancels_used: 0,
      past_due_started_at: null,
      notified_at_day7_dunning: null,
    } as never)
    .eq("id", subscriptionId);
  if (subscriptionUpdate.error) {
    console.error("[stripe-webhook] subscription update failed", subscriptionUpdate.error);
    throw new Error("subscription_update_failed");
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
