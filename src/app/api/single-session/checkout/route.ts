// POST /api/single-session/checkout
//
// Second-phase pay endpoint for $24 single coaching session. Called
// from the form after the parent has picked a Calendly slot. By this
// point /api/single-session/submit has already created the family /
// parent / player / curriculum / slot rows, and the Calendly webhook
// has populated slot.live_call_at + flipped lifecycle to PENDING_PAYMENT.
// All this endpoint does is mint a fresh Stripe Checkout Session
// against the existing customer + curriculum metadata and return its URL.
//
// Idempotent at the Stripe level: if the parent abandons checkout and
// retries, a new Checkout Session is created. Old ones expire on
// Stripe's side; we never reuse a session URL.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const PRICE_CENTS = 2400; // $24

const BodySchema = z.object({
  subscription_id: z.string().uuid(),
});

type SubLookup = {
  id: string;
  player_id: string;
  tier: string | null;
  lifecycle_state: string | null;
  status: string;
};
type PlayerLookup = { id: string; first_name: string; family_id: string };
type FamilyLookup = { id: string; stripe_customer_id: string | null };
type CurriculumLookup = {
  id: string;
  approval_token: string;
  personalization_note: string | null;
  curriculum_type: "subscription" | "single_session" | null;
};

export async function POST(req: Request) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  // Resolve subscription -> player -> family -> curriculum. The
  // single_session curriculum is fetched by curriculum_type so we don't
  // mistakenly bill against a sibling cycle subscription if the family
  // ever has both (unlikely at n=1 but cheap to guard).
  const subResp = await supabase
    .from("subscriptions")
    .select("id, player_id, tier, lifecycle_state, status")
    .eq("id", parsed.subscription_id)
    .maybeSingle();
  const sub = subResp.data as SubLookup | null;
  if (!sub) {
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }
  if (sub.tier !== "single_lesson") {
    return NextResponse.json({ error: "wrong_tier" }, { status: 400 });
  }
  // Pre-payment lifecycle gate. We allow ACCEPTED_PENDING_SCHEDULING
  // (parent hasn't picked the time yet — they came back to the URL)
  // and PENDING_PAYMENT (post-Calendly, pre-pay). Anything else means
  // the session is already paid (ACTIVE) or canceled (CANCELED) and
  // shouldn't re-bill.
  if (
    sub.lifecycle_state !== "PENDING_PAYMENT" &&
    sub.lifecycle_state !== "ACCEPTED_PENDING_SCHEDULING"
  ) {
    return NextResponse.json(
      { error: "subscription_not_pending_payment" },
      { status: 409 },
    );
  }

  const playerResp = await supabase
    .from("players")
    .select("id, first_name, family_id")
    .eq("id", sub.player_id)
    .maybeSingle();
  const player = playerResp.data as PlayerLookup | null;
  if (!player) {
    return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  }

  const familyResp = await supabase
    .from("families")
    .select("id, stripe_customer_id")
    .eq("id", player.family_id)
    .maybeSingle();
  const family = familyResp.data as FamilyLookup | null;
  if (!family) {
    return NextResponse.json({ error: "family_not_found" }, { status: 404 });
  }
  if (!family.stripe_customer_id) {
    return NextResponse.json({ error: "no_stripe_customer" }, { status: 500 });
  }

  const currResp = await supabase
    .from("curricula")
    .select("id, approval_token, personalization_note, curriculum_type" as never)
    .eq("player_id", player.id)
    .eq("curriculum_type" as never, "single_session")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curriculum = currResp.data as CurriculumLookup | null;
  if (!curriculum) {
    return NextResponse.json(
      { error: "curriculum_not_found" },
      { status: 404 },
    );
  }

  const noteShort = (curriculum.personalization_note ?? "").slice(0, 60);
  const noteTail = (curriculum.personalization_note ?? "").length > 60 ? "..." : "";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: family.stripe_customer_id,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${player.first_name}'s single coaching session`,
            description: noteShort
              ? `30 min Discord call with Tim plus lesson materials. Topic: "${noteShort}${noteTail}".`
              : `30 min Discord call with Tim plus lesson materials.`,
          },
          unit_amount: PRICE_CENTS,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      metadata: {
        kind: "single_session",
        curriculum_id: curriculum.id,
        subscription_id: sub.id,
        family_id: family.id,
        player_id: player.id,
      },
    },
    metadata: {
      kind: "single_session",
      curriculum_id: curriculum.id,
      subscription_id: sub.id,
      family_id: family.id,
      player_id: player.id,
      approval_token: curriculum.approval_token,
    },
    success_url: `${APP_URL}/single-session/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/single-session`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "session_url_missing" }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
