// POST /api/portal/refund/request
//
// Parent submits a refund request against a specific Stripe
// PaymentIntent. Hard 60-day window — outside that, we 403 before any
// DB write.
//
// Validation order (cheapest to costliest):
//   1. Auth: user is a parent.
//   2. Body: payment_intent_id + reason both present and well-shaped.
//   3. DB: no existing pending or approved request for this PI.
//   4. Stripe: PI exists, status='succeeded', belongs to this family's
//      customer, created within the last 60 days, not already fully
//      refunded.
//   5. Insert refund_requests row, fire received email.
//
// Outside-window 403 has its own error code so the parent UI can show
// the right copy ("This charge is outside the 60-day window") without
// surfacing the policy implementation detail of "checked against
// pi.created."

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";
import { sendRefundRequestReceivedEmail } from "@/lib/refunds/emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFUND_WINDOW_DAYS = 60;
const REFUND_WINDOW_SECONDS = REFUND_WINDOW_DAYS * 24 * 60 * 60;

const BodySchema = z.object({
  payment_intent_id: z.string().min(1).startsWith("pi_"),
  reason: z.string().trim().min(1).max(2000),
});

type ParentLookup = {
  id: string;
  first_name: string;
  email: string;
  family_id: string;
};
type FamilyLookup = { id: string; stripe_customer_id: string | null };
type PlayerLookup = { id: string };
type SubLookup = { id: string };
type ExistingLookup = { id: string; status: string };

export async function POST(req: Request) {
  // 1. Auth
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parentRow = await supabase
    .from("parents")
    .select("id, first_name, email, family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;
  if (!parent) {
    return NextResponse.json({ error: "not_a_parent" }, { status: 403 });
  }

  // 2. Body
  let parsed: z.infer<typeof BodySchema>;
  try {
    const json = await req.json();
    parsed = BodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: err instanceof Error ? err.message : null },
      { status: 400 },
    );
  }
  const { payment_intent_id, reason } = parsed;

  const service = createServiceRoleClient();

  // Need family + subscription to write the row + fire the email.
  const familyRow = await service
    .from("families")
    .select("id, stripe_customer_id")
    .eq("id", parent.family_id)
    .maybeSingle();
  const family = familyRow.data as FamilyLookup | null;
  if (!family) {
    return NextResponse.json({ error: "family_not_found" }, { status: 404 });
  }
  if (!family.stripe_customer_id) {
    return NextResponse.json({ error: "no_stripe_customer" }, { status: 409 });
  }

  // Pull the family's player → subscription (single-kid MVP).
  const playerRow = await service
    .from("players")
    .select("id")
    .eq("family_id", family.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const player = playerRow.data as PlayerLookup | null;
  if (!player) {
    return NextResponse.json({ error: "no_player" }, { status: 404 });
  }

  const subRow = await service
    .from("subscriptions")
    .select("id")
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subRow.data as SubLookup | null;
  if (!sub) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }

  // 3. DB: existing request? Index-level uniqueness defends this too,
  // but checking first lets us return a specific error code.
  // refund_requests landed in 20260525000300 (not in db.ts until regen).
  const existingResp = await service
    .from("refund_requests" as never)
    .select("id, status")
    .eq("stripe_payment_intent_id", payment_intent_id)
    .in("status", ["pending", "approved"])
    .maybeSingle();
  if (existingResp.data) {
    const existing = (existingResp.data as unknown) as ExistingLookup;
    return NextResponse.json(
      { error: "request_already_open", existing_status: existing.status },
      { status: 409 },
    );
  }

  // 4. Stripe: PI must exist, succeeded, belong to this customer, and
  // be within window.
  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(payment_intent_id, {
      expand: ["latest_charge"],
    });
  } catch (err) {
    console.error("[portal/refund/request] PI retrieve failed", err);
    return NextResponse.json({ error: "stripe_lookup_failed" }, { status: 502 });
  }

  if (pi.status !== "succeeded") {
    return NextResponse.json(
      { error: "charge_not_eligible", reason: `pi_status_${pi.status}` },
      { status: 409 },
    );
  }
  if (pi.customer !== family.stripe_customer_id) {
    // Possession of the PI id is the only thing the parent passed —
    // make sure they're requesting a refund on a charge that belongs
    // to them.
    return NextResponse.json({ error: "not_your_charge" }, { status: 403 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - pi.created;
  if (ageSec > REFUND_WINDOW_SECONDS) {
    const ageDays = Math.floor(ageSec / 86400);
    return NextResponse.json(
      { error: "outside_window", days_past_charge: ageDays, window_days: REFUND_WINDOW_DAYS },
      { status: 403 },
    );
  }

  // If already (partially or fully) refunded, refuse — no double refunds.
  const charge = pi.latest_charge;
  if (typeof charge === "object" && charge !== null) {
    if (charge.refunded || charge.amount_refunded > 0) {
      return NextResponse.json(
        { error: "already_refunded" },
        { status: 409 },
      );
    }
  }

  const chargeDateIso = new Date(pi.created * 1000).toISOString();
  const amountCents = pi.amount;

  // 5. Insert. refund_requests landed in 20260525000300 (not in db.ts
  // until regen); cast the builder through `as unknown as` so the
  // insert+select+single chain stays callable.
  const insertResp = await (service.from("refund_requests" as never) as unknown as {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: string } | null; error: unknown }>;
      };
    };
  })
    .insert({
      family_id: family.id,
      subscription_id: sub.id,
      requested_by_parent_id: parent.id,
      stripe_payment_intent_id: payment_intent_id,
      amount_cents: amountCents,
      charge_date: chargeDateIso,
      reason,
      status: "pending",
    })
    .select("id")
    .single();
  if (insertResp.error || !insertResp.data) {
    console.error("[portal/refund/request] insert failed", insertResp.error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  const refundRequestId = insertResp.data.id;

  // Fire the received email (non-blocking failure — sendBrandedEmail
  // swallows + logs internally).
  await sendRefundRequestReceivedEmail({
    parentEmail: parent.email,
    parentId: parent.id,
    refundRequestId,
    parentFirstName: parent.first_name,
    amountCents,
    chargeDateIso,
  });

  return NextResponse.json({
    ok: true,
    refund_request_id: refundRequestId,
  });
}
