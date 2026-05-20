// POST /api/admin/curriculum-slots/[id]/toggle-vod
//
// Tim flips a slot between lesson mode and VOD review mode. Coach-gated.
//
// Switching ON VOD: requires a vod_url. We clear lesson_id (lesson_xor_vod
// CHECK constraint requires one or the other).
//
// Switching OFF VOD: requires a target lesson_id. We clear vod fields.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("vod_on"),
    slot_id: z.string().uuid().optional(), // ignored; we use the URL param
    vod_url: z.string().url(),
    vod_note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    mode: z.literal("vod_off"),
    lesson_id: z.string().uuid(),
  }),
]);

type SlotLookup = {
  id: string;
  is_vod_review: boolean;
  delivered_at: string | null;
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

  const slotRow = await service
    .from("curriculum_slots")
    .select("id, is_vod_review, delivered_at")
    .eq("id", id)
    .maybeSingle();
  const slot = slotRow.data as SlotLookup | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });
  if (slot.delivered_at) {
    return NextResponse.json({ error: "slot_already_delivered" }, { status: 400 });
  }

  if (body.mode === "vod_on") {
    const upd = await service
      .from("curriculum_slots")
      .update({
        is_vod_review: true,
        lesson_id: null,
        vod_url: body.vod_url,
        vod_talking_points: body.vod_note ? [{ category: "note", text: body.vod_note }] : [],
      } as never)
      .eq("id", slot.id);
    if (upd.error) {
      console.error("[admin/curriculum-slots/toggle-vod:on] update failed", upd.error);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, is_vod_review: true });
  }

  // vod_off
  const lessonRow = await service
    .from("lessons")
    .select("id")
    .eq("id", body.lesson_id)
    .maybeSingle();
  if (!lessonRow.data) {
    return NextResponse.json({ error: "lesson_not_found" }, { status: 404 });
  }

  const upd = await service
    .from("curriculum_slots")
    .update({
      is_vod_review: false,
      lesson_id: body.lesson_id,
      vod_url: null,
      vod_talking_points: null,
    } as never)
    .eq("id", slot.id);
  if (upd.error) {
    console.error("[admin/curriculum-slots/toggle-vod:off] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, is_vod_review: false });
}
