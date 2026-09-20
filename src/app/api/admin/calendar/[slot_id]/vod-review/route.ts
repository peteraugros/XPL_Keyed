// POST   /api/admin/calendar/:slot_id/vod-review   Tim decides this session is a VOD review
// DELETE /api/admin/calendar/:slot_id/vod-review   put it back to a live call
//
// The coach half of the swap. Peter: "or tim could decide its necessary and do
// it too."
//
// It does NOT spend the kid's once per cycle allowance. If Tim judges a session
// is better spent reviewing a VOD, charging the family's one swap for his call
// would punish them for his coaching decision. vod_review_by records which of
// the two happened, because after the fact they are otherwise indistinguishable.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { cancelCalendlyEvent } from "@/lib/calendly/api";
import { canSwapToVodReview, canUndoVodReview, refusalMessage } from "@/lib/sessions/vodReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Slot = {
  id: string;
  delivery_mode: string;
  delivered_at: string | null;
  live_call_at: string | null;
  live_call_event_id: string | null;
  vod_review_by: string | null;
};

async function requireCoach() {
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) return null;
  const coachRow = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  return (coachRow.data as { id: string } | null) ?? null;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ slot_id: string }> },
) {
  const { slot_id } = await ctx.params;
  const coach = await requireCoach();
  if (!coach) return NextResponse.json({ error: "not_a_coach" }, { status: 403 });

  const service = createServiceRoleClient();
  const slotRow = await service
    .from("curriculum_slots")
    .select("id, delivery_mode, delivered_at, live_call_at, live_call_event_id, vod_review_by")
    .eq("id", slot_id)
    .maybeSingle();
  const slot = slotRow.data as Slot | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });

  // Allowance is irrelevant for a coach swap, so 0 is passed rather than read.
  const decision = canSwapToVodReview(slot, "coach", 0);
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.reason, message: refusalMessage(decision.reason) },
      { status: 409 },
    );
  }

  if (slot.live_call_event_id) {
    const cal = await cancelCalendlyEvent(
      slot.live_call_event_id,
      "Coach switched this session to a VOD review",
    );
    if (!cal.ok) console.error("[admin/vod-review] Calendly cancel failed", cal);
  }

  const upd = await service
    .from("curriculum_slots")
    .update({
      delivery_mode: "vod_review",
      vod_review_by: "coach",
      vod_review_at: new Date().toISOString(),
      live_call_event_id: slot.live_call_event_id
        ? `cancelled:${slot.live_call_event_id}`
        : slot.live_call_event_id,
      live_call_at: null,
    } as never)
    .eq("id", slot.id)
    .eq("delivery_mode", "live_call")
    .select("id");
  if (upd.error || !upd.data?.length) {
    return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, delivery_mode: "vod_review", by: "coach" });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ slot_id: string }> },
) {
  const { slot_id } = await ctx.params;
  const coach = await requireCoach();
  if (!coach) return NextResponse.json({ error: "not_a_coach" }, { status: 403 });

  const service = createServiceRoleClient();
  const slotRow = await service
    .from("curriculum_slots")
    .select("id, delivery_mode, delivered_at, live_call_at, live_call_event_id, vod_review_by")
    .eq("id", slot_id)
    .maybeSingle();
  const slot = slotRow.data as Slot | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });

  const decision = canUndoVodReview(slot);
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.reason, message: refusalMessage(decision.reason) },
      { status: 409 },
    );
  }

  // Undoing a STUDENT swap hands their allowance back. Tim reversing his own
  // decision costs nobody anything, so there is nothing to refund.
  if (slot.vod_review_by === "student") {
    const curRow = await service
      .from("curriculum_slots")
      .select("curriculum_id")
      .eq("id", slot.id)
      .single();
    const cur = await service
      .from("curricula")
      .select("player_id")
      .eq("id", (curRow.data as { curriculum_id: string }).curriculum_id)
      .single();
    const subRow = await service
      .from("subscriptions")
      .select("id, cycle_vod_reviews_used")
      .eq("player_id", (cur.data as { player_id: string }).player_id)
      .maybeSingle();
    const sub = subRow.data as { id: string; cycle_vod_reviews_used: number } | null;
    if (sub) {
      await service
        .from("subscriptions")
        .update({
          cycle_vod_reviews_used: Math.max(0, sub.cycle_vod_reviews_used - 1),
        } as never)
        .eq("id", sub.id);
    }
  }

  const upd = await service
    .from("curriculum_slots")
    .update({
      delivery_mode: "live_call",
      vod_review_by: null,
      vod_review_at: null,
      vod_upload_id: null,
    } as never)
    .eq("id", slot.id)
    .eq("delivery_mode", "vod_review")
    .select("id");
  if (upd.error || !upd.data?.length) {
    return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, delivery_mode: "live_call", needs_rebooking: true });
}
