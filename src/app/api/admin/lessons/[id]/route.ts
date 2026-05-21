// PATCH /api/admin/lessons/[id]
//
// Coach-gated. Edits text fields on an existing lesson: all metadata,
// speaker_notes on each slide, and parent_talking_points. Media (slide
// images + audio) are NOT changed by this endpoint — Tim re-authors a
// fresh lesson via /admin/lessons/new if he wants new media.
//
// Slide shape preserved: existing slides keep their image_url +
// audio_url; only speaker_notes is overwritten from the request body.
// Position is preserved from the existing array order.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    fortnite_label: z.string().trim().min(1).max(120),
    parent_label: z.string().trim().min(1).max(180),
    parent_skill_description: z.string().trim().min(1).max(500),
    topic: z.enum([
      "building",
      "editing",
      "aim",
      "game_sense",
      "mental",
      "tournament_prep",
    ]),
    difficulty_level: z.enum(["beginner", "intermediate", "advanced", "unreal"]),
    duration_minutes: z.number().int().min(1).max(120),
    is_published: z.boolean(),
    slide_notes: z.array(z.string().max(2000)),
    parent_talking_points: z.array(
      z.object({
        category: z.string(),
        text: z.string().max(500),
      }),
    ),
  })
  .strict();

type Slide = {
  position?: number;
  image_url?: string | null;
  audio_url?: string | null;
  speaker_notes?: string;
};

export async function PATCH(
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
  } catch (err) {
    console.error("[admin/lessons/PATCH] invalid_body", err);
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const lookup = await service
    .from("lessons")
    .select("id, slides")
    .eq("id", id)
    .maybeSingle();
  if (!lookup.data) {
    return NextResponse.json({ error: "lesson_not_found" }, { status: 404 });
  }

  // Preserve existing media URLs; overwrite speaker_notes per index.
  const existingSlides = (lookup.data as { slides: Slide[] | null }).slides ?? [];
  const newSlides: Slide[] = body.slide_notes.map((note, i) => ({
    position: i,
    image_url: existingSlides[i]?.image_url ?? null,
    audio_url: existingSlides[i]?.audio_url ?? null,
    speaker_notes: note,
  }));

  const upd = await service
    .from("lessons")
    .update({
      title: body.title,
      fortnite_label: body.fortnite_label,
      parent_label: body.parent_label,
      parent_skill_description: body.parent_skill_description,
      topic: body.topic,
      difficulty_level: body.difficulty_level,
      duration_minutes: body.duration_minutes,
      is_published: body.is_published,
      slides: newSlides,
      parent_talking_points: body.parent_talking_points,
    } as never)
    .eq("id", id);
  if (upd.error) {
    console.error("[admin/lessons/PATCH] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
