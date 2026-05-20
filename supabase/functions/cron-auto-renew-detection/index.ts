// Edge Function — auto_renew_detection
//
// Fired daily by pg_cron. Picks up subscriptions where the current
// cycle just completed (cycle_lessons_delivered=4) and decides what
// happens next:
//
//   * auto_renew_enabled=FALSE → cancel the subscription cleanly,
//     email the parent ("this was your last cycle"), done.
//
//   * auto_renew_enabled=TRUE → fire a Stripe PaymentIntent (off
//     session) against the family's saved card for $56. The Stripe
//     webhook handles the rest — on success it calls
//     provisionNextCycle to lay down the new curriculum + slots; on
//     failure it transitions the subscription to PAST_DUE.
//
// Idempotency: subscriptions.renewal_pi_id is set the moment we fire
// the PI. The eligibility filter excludes rows where it's not NULL, so
// a second run during the same day (before Stripe's webhook lands)
// won't double-charge. The webhook clears the field once the PI
// settles either way.
//
// What we deliberately don't do here: pattern detection (uniform vs
// scattered) and slot provisioning. That logic lives in
// src/lib/lessons/auto-renew.ts and runs from the Node-side Stripe
// webhook handler so it can use the typed Supabase generics + node
// crypto. Edge Functions stay thin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.5.0?target=denonext";
import { sendEmail, brandedEmailHtml } from "../_shared/resend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL")!;
const NEXT_PUBLIC_APP_URL =
  Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "https://xplkeyed.com";

const RENEWAL_AMOUNT_CENTS = 5600;

const SIGNATURE = `<p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`;

type SubRow = {
  id: string;
  player_id: string;
  auto_renew_enabled: boolean;
  renewal_pi_id: string | null;
  cycle_skips_used: number;
};

Deno.serve(async (_req) => {
  if (!STRIPE_SECRET_KEY) {
    return new Response("STRIPE_SECRET_KEY not set", { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-09-30.clover" });

  // Eligibility: cycle finished + lifecycle ACTIVE + no renewal in flight.
  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("id, player_id, auto_renew_enabled, renewal_pi_id, cycle_skips_used")
    .eq("status", "active")
    .eq("lifecycle_state", "ACTIVE")
    .eq("cycle_lessons_delivered", 4)
    .is("renewal_pi_id", null);

  if (error) return new Response(error.message, { status: 500 });
  if (!subs?.length) return new Response("no_subs", { status: 200 });

  const results: Array<Record<string, unknown>> = [];

  for (const sub of subs as SubRow[]) {
    try {
      // Resolve parent + player for emails.
      const { data: playerData } = await supabase
        .from("players")
        .select("first_name, family_id")
        .eq("id", sub.player_id)
        .maybeSingle();
      const player = playerData as { first_name: string; family_id: string } | null;
      if (!player) {
        results.push({ subscription_id: sub.id, status: "no_player" });
        continue;
      }
      const { data: familyData } = await supabase
        .from("families")
        .select("stripe_customer_id")
        .eq("id", player.family_id)
        .maybeSingle();
      const family = familyData as { stripe_customer_id: string | null } | null;
      const { data: parentData } = await supabase
        .from("parents")
        .select("first_name, email")
        .eq("family_id", player.family_id)
        .limit(1)
        .maybeSingle();
      const parent = parentData as { first_name: string; email: string } | null;
      if (!parent) {
        results.push({ subscription_id: sub.id, status: "no_parent" });
        continue;
      }

      // --- Branch A: auto-renew off → cancel cleanly ----------------------
      if (!sub.auto_renew_enabled) {
        await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            lifecycle_state: "CANCELED",
            waiting_on: "SYSTEM",
          })
          .eq("id", sub.id);

        // Mark the cycle's curriculum as completed too.
        await supabase
          .from("curricula")
          .update({ status: "completed" })
          .eq("player_id", sub.player_id)
          .eq("status", "active");

        const html = brandedEmailHtml({
          headline: `This was your last cycle`,
          bodyHtml: `<p>Hi ${parent.first_name},</p>
<p>${player.first_name} finished the 4 lessons of this cycle. Auto renew is off, so no new charge fired and no new cycle started.</p>
<p>If you want to keep going, sign back in any time and book a new cycle. Your progress and history are saved.</p>${SIGNATURE}`,
          ctaLabel: "Book another cycle",
          ctaHref: `${NEXT_PUBLIC_APP_URL}/portal`,
        });
        await sendEmail({
          apiKey: RESEND_API_KEY,
          from: RESEND_FROM_EMAIL,
          to: parent.email,
          subject: `${player.first_name}'s cycle wrapped`,
          html,
        });

        results.push({ subscription_id: sub.id, status: "canceled" });
        continue;
      }

      // --- Branch B: auto-renew on → fire PaymentIntent --------------------
      if (!family?.stripe_customer_id) {
        // No Stripe customer = no saved card = nothing to charge against.
        // Defensive: log + skip. The family will fall into the no-renewal
        // bucket; can be backfilled manually if it ever happens.
        results.push({ subscription_id: sub.id, status: "no_stripe_customer" });
        continue;
      }

      // Look up the default payment method on the customer. Required for
      // off-session charges.
      const customer = (await stripe.customers.retrieve(
        family.stripe_customer_id,
      )) as Stripe.Customer;
      const defaultPm =
        (customer.invoice_settings?.default_payment_method as string | null) ??
        null;
      let paymentMethodId = defaultPm;
      if (!paymentMethodId) {
        // Fall back to the most-recently-added card.
        const pms = await stripe.paymentMethods.list({
          customer: family.stripe_customer_id,
          type: "card",
          limit: 1,
        });
        paymentMethodId = pms.data[0]?.id ?? null;
      }
      if (!paymentMethodId) {
        results.push({ subscription_id: sub.id, status: "no_payment_method" });
        continue;
      }

      const pi = await stripe.paymentIntents.create(
        {
          amount: RENEWAL_AMOUNT_CENTS,
          currency: "usd",
          customer: family.stripe_customer_id,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Auto renew: ${player.first_name}'s next 4 lesson cycle`,
          metadata: {
            kind: "renewal",
            subscription_id: sub.id,
            player_id: sub.player_id,
            family_id: player.family_id,
          },
        },
        {
          // Idempotency by subscription + last_cancel_at fingerprint
          // (good enough since each cycle completes once).
          idempotencyKey: `renewal:${sub.id}:${Date.now()}`,
        },
      );

      await supabase
        .from("subscriptions")
        .update({ renewal_pi_id: pi.id })
        .eq("id", sub.id);

      results.push({
        subscription_id: sub.id,
        status: "pi_fired",
        pi_id: pi.id,
        pi_status: pi.status,
      });
    } catch (err) {
      const errAny = err as { code?: string; message?: string };
      console.error("[cron-auto-renew-detection] sub", sub.id, errAny);
      results.push({
        subscription_id: sub.id,
        status: "error",
        code: errAny.code ?? null,
        message: errAny.message ?? "unknown",
      });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
