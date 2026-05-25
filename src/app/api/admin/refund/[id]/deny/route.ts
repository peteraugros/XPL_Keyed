// POST /api/admin/refund/[id]/deny
//
// Coach denies a pending refund request. Decision note is REQUIRED for
// deny (unlike approve, where it's optional) because the parent needs
// to know why. Sends the denied email with the note inline.
//
// Idempotent against non-pending rows: 409s if already decided.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { sendRefundDeniedEmail } from "@/lib/refunds/emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  decision_note: z.string().trim().min(1).max(2000),
});

type CoachLookup = { id: string };
type RefundLookup = {
  id: string;
  status: "pending" | "approved" | "denied";
  family_id: string;
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
    const json = await req.json();
    parsed = BodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: err instanceof Error ? err.message : null },
      { status: 400 },
    );
  }
  const decisionNote = parsed.decision_note.trim();

  const service = createServiceRoleClient();

  // refund_requests landed in 20260525000300 (not in db.ts until regen).
  const refundResp = await service
    .from("refund_requests" as never)
    .select("id, status, family_id, amount_cents, charge_date")
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

  const parentResp = await service
    .from("parents")
    .select("id, first_name, email")
    .eq("family_id", refund.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parent = parentResp.data as ParentLookup | null;

  // Structural cast around the builder until db.ts regen.
  const upd = await (service.from("refund_requests" as never) as unknown as {
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  })
    .update({
      status: "denied",
      decided_by_coach_id: coach.id,
      decided_at: new Date().toISOString(),
      decision_note: decisionNote,
    })
    .eq("id", refund.id);
  if (upd.error) {
    console.error("[admin/refund/deny] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  if (parent?.email) {
    await sendRefundDeniedEmail({
      parentEmail: parent.email,
      parentId: parent.id,
      refundRequestId: refund.id,
      parentFirstName: parent.first_name,
      amountCents: refund.amount_cents,
      chargeDateIso: refund.charge_date,
      decisionNote,
    });
  }

  return NextResponse.json({ ok: true });
}
