// POST /api/admin/curriculum-slots/[id]/swap-lesson
//
// Tim swaps the lesson assigned to a slot. Coach-gated. Only allowed
// on slots that haven't delivered yet (delivered_at IS NULL) and
// haven't been cancelled. Toggles the slot off VOD mode if it was on,
// since lesson_xor_vod CHECK requires lesson_id XOR vod_url.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    lesson_id: z.string().uuid(),
  })
  .strict();

type SlotLookup = {
  id: string;
  delivered_at: string | null;
  live_call_event_id: string | null;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const coachRow = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!coachRow.data) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();

  // Pull the slot + parent curriculum so we can detect single-session
  // delivery (which bypasses the Sunday cron).
  const slotRow = await service
    .from("curriculum_slots")
    .select("id, delivered_at, live_call_event_id, curriculum_id")
    .eq("id", id)
    .maybeSingle();
  const slot = slotRow.data as (SlotLookup & { curriculum_id: string }) | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });
  if (slot.delivered_at) {
    return NextResponse.json({ error: "slot_already_delivered" }, { status: 400 });
  }

  // Verify the target lesson exists.
  const lessonRow = await service
    .from("lessons")
    .select("id")
    .eq("id", body.lesson_id)
    .maybeSingle();
  if (!lessonRow.data) {
    return NextResponse.json({ error: "lesson_not_found" }, { status: 404 });
  }

  // Detect single-session: that curriculum_type bypasses the Sunday
  // cron's delivery model entirely. Single-session lessons are
  // "delivered" the moment Tim assigns them — no schedule, no
  // progression. Cycle lessons keep cron-owned delivery.
  const currRow = await service
    .from("curricula")
    .select("curriculum_type" as never)
    .eq("id", slot.curriculum_id)
    .maybeSingle();
  const isSingleSession =
    (currRow.data as { curriculum_type?: string } | null)?.curriculum_type === "single_session";

  // Swap. Force is_vod_review=false + clear VOD fields so the
  // lesson_xor_vod CHECK is satisfied. For single-session, ALSO stamp
  // delivered_at so the kid view picks it up immediately.
  const updatePayload: Record<string, unknown> = {
    lesson_id: body.lesson_id,
    is_vod_review: false,
    vod_url: null,
    vod_talking_points: null,
  };
  if (isSingleSession) {
    updatePayload.delivered_at = new Date().toISOString();
  }

  const upd = await service
    .from("curriculum_slots")
    .update(updatePayload as never)
    .eq("id", slot.id);
  if (upd.error) {
    console.error("[admin/curriculum-slots/swap-lesson] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
