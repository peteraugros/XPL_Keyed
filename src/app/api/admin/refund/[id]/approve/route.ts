// POST /api/admin/refund/[id]/approve
//
// Coach approves a pending refund request. Fires a Stripe refund
// against the original PaymentIntent, stamps the row, sends the
// approved email to the parent.
//
// Idempotency: refuses if the row is no longer status='pending'. The
// `idempotency_key` we send to Stripe is `refund:<refund_request_id>`
// so a network blip + retry doesn't double-refund.
//
// Stripe failure (e.g. balance not available) leaves the row in
// 'pending' state and surfaces the Stripe error to the caller so Peter
// can decide whether to retry or escalate.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";
import { sendRefundApprovedEmail } from "@/lib/refunds/emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  decision_note: z.string().trim().max(2000).optional().nullable(),
});

type CoachLookup = { id: string };
type RefundLookup = {
  id: string;
  status: "pending" | "approved" | "denied";
  family_id: string;
  subscription_id: string;
  stripe_payment_intent_id: string;
  amount_cents: number;
  charge_date: string;
};
type ParentLookup = { id: string; first_name: string; email: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const coachRow = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  const coach = coachRow.data as CoachLookup | null;
  if (!coach) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    const json = await req.json().catch(() => ({}));
    parsed = BodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: err instanceof Error ? err.message : null },
      { status: 400 },
    );
  }
  const decisionNote = parsed.decision_note?.trim() || null;

  const service = createServiceRoleClient();

  // refund_requests landed in 20260525000300 (not in db.ts until regen).
  const refundResp = await service
    .from("refund_requests" as never)
    .select(
      "id, status, family_id, subscription_id, stripe_payment_intent_id, amount_cents, charge_date",
    )
    .eq("id", id)
    .maybeSingle();
  const refund = (refundResp.data as unknown) as RefundLookup | null;
  if (!refund) {
    return NextResponse.json({ error: "refund_request_not_found" }, { status: 404 });
  }
  if (refund.status !== "pending") {
    return NextResponse.json(
      { error: "not_pending", current_status: refund.status },
      { status: 409 },
    );
  }

  // Look up the requesting parent so we can email them. If the parent
  // row is gone (deleted) we still complete the refund.
  const parentResp = await service
    .from("parents")
    .select("id, first_name, email")
    .eq("family_id", refund.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parent = parentResp.data as ParentLookup | null;

  // Fire the Stripe refund.
  let stripeRefundId: string;
  try {
    const created = await stripe.refunds.create(
      {
        payment_intent: refund.stripe_payment_intent_id,
        reason: "requested_by_customer",
        metadata: {
          refund_request_id: refund.id,
          family_id: refund.family_id,
          subscription_id: refund.subscription_id,
        },
      },
      {
        // Stripe's idempotency_key prevents double-charge on retry.
        idempotencyKey: `refund:${refund.id}`,
      },
    );
    stripeRefundId = created.id;
  } catch (err) {
    console.error("[admin/refund/approve] stripe.refunds.create failed", err);
    return NextResponse.json(
      {
        error: "stripe_refund_failed",
        detail: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }

  // Stamp the row. Structural cast around the builder so update+eq
  // stays callable until db.ts regen.
  const upd = await (service.from("refund_requests" as never) as unknown as {
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  })
    .update({
      status: "approved",
      decided_by_coach_id: coach.id,
      decided_at: new Date().toISOString(),
      decision_note: decisionNote,
      stripe_refund_id: stripeRefundId,
    })
    .eq("id", refund.id);
  if (upd.error) {
    // The refund DID go through at Stripe. Log loudly so Peter can
    // hand-reconcile if needed.
    console.error(
      "[admin/refund/approve] DB update failed AFTER successful Stripe refund",
      { refund_id: refund.id, stripe_refund_id: stripeRefundId, error: upd.error },
    );
    return NextResponse.json(
      {
        error: "db_update_failed_after_refund",
        stripe_refund_id: stripeRefundId,
        detail: upd.error.message,
      },
      { status: 500 },
    );
  }

  // Email the parent. Best-effort.
  if (parent?.email) {
    await sendRefundApprovedEmail({
      parentEmail: parent.email,
      parentId: parent.id,
      refundRequestId: refund.id,
      parentFirstName: parent.first_name,
      amountCents: refund.amount_cents,
      chargeDateIso: refund.charge_date,
      decisionNote,
    });
  }

  return NextResponse.json({
    ok: true,
    stripe_refund_id: stripeRefundId,
  });
}
