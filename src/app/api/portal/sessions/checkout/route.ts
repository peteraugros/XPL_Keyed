// POST /api/portal/sessions/checkout
//
// Parent-authed checkout endpoint for the new phase 2 flow. Replaces
// the token-based /api/curriculum/[token]/checkout call from the
// approval page (which is no longer used in the new flow; that path
// goes through /api/curriculum/[token]/approve first).
//
// Auth: cookie session. Body: { curriculum_id }. The curriculum must
// belong to the parent's family and the subscription must be in
// PENDING_PAYMENT lifecycle state. Otherwise reject.
//
// Mirrors the existing token endpoint's Stripe Customer + Checkout
// Session creation. Stripe webhook handler (checkout.session.completed)
// flips lifecycle_state='ACTIVE' on success.

import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const bodySchema = z
  .object({
    curriculum_id: z.string().uuid(),
  })
  .strict();

type ParentLookup = { id: string; family_id: string };
type CurriculumLookup = {
  id: string;
  player_id: string;
  approval_token: string;
};
type PlayerLookup = { id: string; family_id: string; first_name: string };
type FamilyLookup = { id: string; stripe_customer_id: string | null };
type ParentForStripe = { email: string; first_name: string };
type SubscriptionLookup = { id: string; lifecycle_state: string };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Verify the authed user is a parent.
  const parentRow = await supabase
    .from("parents")
    .select("id, family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;
  if (!parent) {
    return NextResponse.json({ error: "not_a_parent" }, { status: 403 });
  }

  // Service role for the rest (cross-family verification + Stripe meta writes).
  const service = createServiceRoleClient();

  const curriculumLookup = await service
    .from("curricula")
    .select("id, player_id, approval_token")
    .eq("id", body.curriculum_id)
    .maybeSingle();
  const curriculum = curriculumLookup.data as CurriculumLookup | null;
  if (!curriculum) {
    return NextResponse.json({ error: "curriculum_not_found" }, { status: 404 });
  }

  const playerLookup = await service
    .from("players")
    .select("id, family_id, first_name")
    .eq("id", curriculum.player_id)
    .maybeSingle();
  const player = playerLookup.data as PlayerLookup | null;
  if (!player || player.family_id !== parent.family_id) {
    return NextResponse.json({ error: "not_your_family" }, { status: 403 });
  }

  const subscriptionLookup = await service
    .from("subscriptions")
    .select("id, lifecycle_state")
    .eq("player_id", player.id)
    .maybeSingle();
  const subscription = subscriptionLookup.data as SubscriptionLookup | null;
  if (!subscription) {
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }
  if (subscription.lifecycle_state !== "PENDING_PAYMENT") {
    return NextResponse.json(
      { error: "not_pending_payment", actual: subscription.lifecycle_state },
      { status: 409 },
    );
  }

  const familyLookup = await service
    .from("families")
    .select("id, stripe_customer_id")
    .eq("id", player.family_id)
    .maybeSingle();
  const family = familyLookup.data as FamilyLookup | null;
  if (!family) {
    return NextResponse.json({ error: "family_not_found" }, { status: 404 });
  }

  const parentForStripeLookup = await service
    .from("parents")
    .select("email, first_name")
    .eq("family_id", player.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parentForStripe = parentForStripeLookup.data as ParentForStripe | null;
  if (!parentForStripe) {
    return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
  }

  // Ensure Stripe Customer exists.
  let stripeCustomerId = family.stripe_customer_id;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: parentForStripe.email,
      name: parentForStripe.first_name,
      metadata: {
        family_id: family.id,
        xpl_keyed_player_id: player.id,
      },
    });
    stripeCustomerId = customer.id;
    const updateResult = await service
      .from("families")
      .update({ stripe_customer_id: stripeCustomerId } as never)
      .eq("id", family.id);
    if (updateResult.error) {
      console.error("[sessions/checkout] family stripe_customer_id update failed", updateResult.error);
    }
  }

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
      approval_token: curriculum.approval_token,
    },
    success_url: `${APP_URL}/curriculum/${curriculum.approval_token}/success`,
    cancel_url: `${APP_URL}/portal/sessions`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "session_url_missing" }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
