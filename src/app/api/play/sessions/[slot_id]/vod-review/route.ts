// POST   /api/play/sessions/:slot_id/vod-review   turn this session into a VOD review
// DELETE /api/play/sessions/:slot_id/vod-review   change my mind, put the call back
//
// STUDENT facing. The kid acts; the parent watches. Per Peter: "parents are
// there only to see, for the sake of transparency."
//
// Ownership is resolved slot -> curriculum -> player and compared to the
// player behind the cookie session. The body carries no player id, so there is
// nothing to forge; a kid can only ever reach their own sessions.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { cancelCalendlyEvent } from "@/lib/calendly/api";
import {
  canSwapToVodReview,
  canUndoVodReview,
  allowanceAfterSwap,
  allowanceAfterUndo,
  refusalMessage,
} from "@/lib/sessions/vodReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({ vod_url: z.string().trim().min(8).max(2048).url().optional() })
  .strict();

type Slot = {
  id: string;
  curriculum_id: string;
  delivery_mode: string;
  delivered_at: string | null;
  live_call_at: string | null;
  live_call_event_id: string | null;
  vod_review_by: string | null;
  week_number: number;
};

async function resolve(slotId: string) {
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) return { error: "unauthorized" as const, status: 401 };

  const playerRow = await supabase
    .from("players")
    .select("id")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const player = playerRow.data as { id: string } | null;
  if (!player) return { error: "not_a_player" as const, status: 403 };

  const service = createServiceRoleClient();
  const slotRow = await service
    .from("curriculum_slots")
    .select(
      "id, curriculum_id, delivery_mode, delivered_at, live_call_at, live_call_event_id, vod_review_by, week_number",
    )
    .eq("id", slotId)
    .maybeSingle();
  const slot = slotRow.data as Slot | null;
  if (!slot) return { error: "slot_not_found" as const, status: 404 };

  const curRow = await service
    .from("curricula")
    .select("id, player_id")
    .eq("id", slot.curriculum_id)
    .maybeSingle();
  const cur = curRow.data as { id: string; player_id: string } | null;
  // Same answer for "does not exist" and "is not yours": a kid must not be
  // able to probe for other families' session ids.
  if (!cur || cur.player_id !== player.id) {
    return { error: "slot_not_found" as const, status: 404 };
  }

  const subRow = await service
    .from("subscriptions")
    .select("id, cycle_vod_reviews_used")
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subRow.data as { id: string; cycle_vod_reviews_used: number } | null;
  if (!sub) return { error: "subscription_not_found" as const, status: 404 };

  return { player, slot, sub, service };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slot_id: string }> },
) {
  const { slot_id } = await ctx.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const r = await resolve(slot_id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { slot, sub, service, player } = r;

  const decision = canSwapToVodReview(slot, "student", sub.cycle_vod_reviews_used);
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.reason, message: refusalMessage(decision.reason) },
      { status: 409 },
    );
  }

  // The VOD link is optional here on purpose: a kid who knows they cannot make
  // Tuesday should be able to act before they have clipped anything.
  let vodUploadId: string | null = null;
  if (body.vod_url) {
    const ins = await service
      .from("vod_uploads")
      .insert({
        player_id: player.id,
        source: "paste_url",
        url: body.vod_url,
        // NOT a trial VOD. That flag means "a prospect submitted this before
        // they were a client" and this family already is one.
        is_initial_trial_vod: false,
      } as never)
      .select("id")
      .single();
    if (ins.error) {
      console.error("[play/vod-review] vod insert failed", ins.error);
      return NextResponse.json({ error: "vod_insert_failed" }, { status: 500 });
    }
    vodUploadId = (ins.data as { id: string }).id;
  }

  // Release Tim's calendar. Idempotent, and a failure must not block the swap:
  // local state is the source of truth, exactly as the cancel route treats it.
  if (slot.live_call_event_id) {
    const cal = await cancelCalendlyEvent(
      slot.live_call_event_id,
      "Student switched this session to a VOD review",
    );
    if (!cal.ok) console.error("[play/vod-review] Calendly cancel failed", cal);
  }

  const nowIso = new Date().toISOString();
  const slotUpd = await service
    .from("curriculum_slots")
    .update({
      delivery_mode: "vod_review",
      vod_review_by: "student",
      vod_review_at: nowIso,
      vod_upload_id: vodUploadId,
      live_call_event_id: slot.live_call_event_id
        ? `cancelled:${slot.live_call_event_id}`
        : slot.live_call_event_id,
      // The call is not happening. Clearing the time is what stops the
      // reminder crons treating this as an upcoming live call.
      live_call_at: null,
    } as never)
    .eq("id", slot.id)
    // Guard against a double submit racing itself: only swap a slot that is
    // still a live call.
    .eq("delivery_mode", "live_call")
    .select("id");
  if (slotUpd.error) {
    console.error("[play/vod-review] slot update failed", slotUpd.error);
    return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
  }
  if (!slotUpd.data || slotUpd.data.length === 0) {
    return NextResponse.json({ error: "already_vod_review" }, { status: 409 });
  }

  const subUpd = await service
    .from("subscriptions")
    .update({
      cycle_vod_reviews_used: allowanceAfterSwap(sub.cycle_vod_reviews_used, "student"),
    } as never)
    .eq("id", sub.id);
  if (subUpd.error) {
    console.error("[play/vod-review] allowance update failed", subUpd.error);
  }

  return NextResponse.json({
    ok: true,
    delivery_mode: "vod_review",
    vod_attached: vodUploadId !== null,
    vod_reviews_used: allowanceAfterSwap(sub.cycle_vod_reviews_used, "student"),
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ slot_id: string }> },
) {
  const { slot_id } = await ctx.params;
  const r = await resolve(slot_id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { slot, sub, service } = r;

  const decision = canUndoVodReview(slot);
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.reason, message: refusalMessage(decision.reason) },
      { status: 409 },
    );
  }
  // A kid may only undo their own swap. Undoing one Tim made would let them
  // reverse a coaching decision.
  if (slot.vod_review_by !== "student") {
    return NextResponse.json({ error: "coach_decided" }, { status: 403 });
  }

  // The live call is NOT restored: the Calendly event was released and the
  // time is gone. The kid rebooks through the normal scheduling path, which is
  // why the allowance comes back with it.
  const slotUpd = await service
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
  if (slotUpd.error || !slotUpd.data?.length) {
    return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
  }

  await service
    .from("subscriptions")
    .update({
      cycle_vod_reviews_used: allowanceAfterUndo(sub.cycle_vod_reviews_used, "student"),
    } as never)
    .eq("id", sub.id);

  return NextResponse.json({ ok: true, delivery_mode: "live_call", needs_rebooking: true });
}
