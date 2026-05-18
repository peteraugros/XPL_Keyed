// POST /api/curriculum/[token]/checkout
//
// Parent-initiated. Approves a pending curriculum and starts payment. Token
// in the URL is the curriculum.approval_token (32-byte hex) emailed to the
// parent by Tim's "Take Jake on" flow. Possession of the token is the gate
// — no session auth required, mirroring the magic-link verification model.
//
// What this does:
//   1. Resolve curriculum -> player -> family -> parent.
//   2. Ensure the family has a Stripe Customer (create one if missing,
//      stash the id on families.stripe_customer_id).
//   3. Create a Stripe Checkout Session in `payment` mode for $56 (the
//      first 4-lesson cycle). `setup_future_usage='off_session'` saves
//      the card on the Customer so future cycles can be charged via
//      our cycle-advance cron without re-prompting the parent.
//   4. Stash curriculum_id, subscription_id, family_id, player_id in
//      session metadata so the Stripe webhook can find the right rows
//      when checkout.session.completed fires.
//   5. Return { url } so the client can redirect to Stripe's hosted page.
//
// The DB writes that activate the curriculum (curricula.status='active'
// + subscriptions.tier='monthly' + subscriptions.status='active' +
// cycle_started_at) happen in the Stripe webhook handler. This endpoint
// only sets up the payment session.

import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(
  _req: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // ---- 1. Resolve curriculum + everything we need --------------------------
  const curriculumLookup = await supabase
    .from("curricula")
    .select("id, status, player_id")
    .eq("approval_token", token)
    .maybeSingle();
  const curriculum = curriculumLookup.data as
    | { id: string; status: string; player_id: string }
    | null;
  if (!curriculum) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (curriculum.status !== "pending_approval") {
    return NextResponse.json(
      { error: "curriculum_not_pending", actual_status: curriculum.status },
      { status: 409 },
    );
  }

  const playerLookup = await supabase
    .from("players")
    .select("id, family_id, first_name")
    .eq("id", curriculum.player_id)
    .maybeSingle();
  const player = playerLookup.data as
    | { id: string; family_id: string; first_name: string }
    | null;
  if (!player) {
    return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  }

  const familyLookup = await supabase
    .from("families")
    .select("id, stripe_customer_id")
    .eq("id", player.family_id)
    .maybeSingle();
  const family = familyLookup.data as
    | { id: string; stripe_customer_id: string | null }
    | null;
  if (!family) {
    return NextResponse.json({ error: "family_not_found" }, { status: 404 });
  }

  const parentLookup = await supabase
    .from("parents")
    .select("email, first_name")
    .eq("family_id", player.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parent = parentLookup.data as
    | { email: string; first_name: string }
    | null;
  if (!parent) {
    return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
  }

  const subscriptionLookup = await supabase
    .from("subscriptions")
    .select("id")
    .eq("player_id", player.id)
    .maybeSingle();
  const subscription = subscriptionLookup.data as { id: string } | null;
  if (!subscription) {
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }

  // ---- 2. Ensure Stripe Customer exists -----------------------------------
  let stripeCustomerId = family.stripe_customer_id;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: parent.email,
      name: parent.first_name,
      metadata: {
        family_id: family.id,
        xpl_keyed_player_id: player.id,
      },
    });
    stripeCustomerId = customer.id;
    const updateResult = await supabase
      .from("families")
      .update({ stripe_customer_id: stripeCustomerId } as never)
      .eq("id", family.id);
    if (updateResult.error) {
      console.error("[checkout] family stripe_customer_id update failed", updateResult.error);
      // Don't bail — checkout still works, we just won't reuse the
      // customer on a later cycle. Logged for follow-up.
    }
  }

  // ---- 3. Create Checkout Session -----------------------------------------
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${player.first_name}'s 4 lesson cycle`,
            description: "XPL Keyed coaching. $56 for 4 weekly lessons.",
          },
          unit_amount: 5600,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      // Save the card on the Customer so future cycles (cron-driven) can
      // charge without re-prompting the parent.
      setup_future_usage: "off_session",
      metadata: {
        kind: "first_cycle",
        curriculum_id: curriculum.id,
        subscription_id: subscription.id,
        family_id: family.id,
        player_id: player.id,
      },
    },
    metadata: {
      kind: "first_cycle",
      curriculum_id: curriculum.id,
      subscription_id: subscription.id,
      family_id: family.id,
      player_id: player.id,
      approval_token: token,
    },
    success_url: `${APP_URL}/curriculum/${token}/success`,
    cancel_url: `${APP_URL}/curriculum/${token}`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "session_url_missing" }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
