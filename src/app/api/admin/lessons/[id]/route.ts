// PATCH /api/admin/lessons/[id]
// DELETE /api/admin/lessons/[id]
//
// Coach-gated. Planner-era updates: every field is optional so the
// planner UI can autosave any subset on each keystroke / step
// transition. The slide-era body (slide_notes, parent_talking_points
// strict shape) is gone. PATCH now accepts any of the planner JSONB
// columns plus the publish-time metadata.
//
// DELETE removes a draft lesson outright. Used from the library list
// to clean up abandoned drafts.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOPICS = [
  "building",
  "editing",
  "aim",
  "game_sense",
  "mental",
  "tournament_prep",
] as const;
const DIFFICULTIES = ["beginner", "intermediate", "advanced", "unreal"] as const;

const BeatSheetSchema = z
  .object({
    hook: z.string().max(1000).optional().default(""),
    goal: z.string().max(1000).optional().default(""),
    demonstration: z.string().max(2000).optional().default(""),
    breakdown: z
      .array(
        z.object({
          bullet: z.string().max(600).optional().default(""),
          why: z.string().max(1000).optional().default(""),
        }),
      )
      .max(20)
      .optional()
      .default([]),
    commonMistake: z.string().max(2000).optional().default(""),
    practiceSetup: z.string().max(2000).optional().default(""),
    summary: z.string().max(2000).optional().default(""),
    outro: z.string().max(1000).optional().default(""),
  })
  .partial();

const TermsSchema = z
  .array(
    z.object({
      word: z.string().max(80).optional().default(""),
      definition: z.string().max(500).optional().default(""),
    }),
  )
  .max(30);

// planner_state is the catch-all editor state. Schema is loose because
// it grows as the planner UI evolves and we don't want to migrate the
// endpoint each time. Coach-gated, validated for size only.
const PlannerStateSchema = z.record(z.string(), z.unknown());

const PtpSchema = z.array(
  z.object({
    category: z.string().max(60),
    text: z.string().max(600),
  }),
).max(10);

const bodySchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  fortnite_label: z.string().trim().min(1).max(120).nullable().optional(),
  parent_label: z.string().trim().min(1).max(180).nullable().optional(),
  parent_skill_description: z.string().trim().min(1).max(500).nullable().optional(),
  topic: z.enum(TOPICS).nullable().optional(),
  difficulty_level: z.enum(DIFFICULTIES).nullable().optional(),
  duration_minutes: z.number().int().min(1).max(120).nullable().optional(),
  is_published: z.boolean().optional(),
  video_url: z.string().trim().max(2000).nullable().optional(),
  beat_sheet: BeatSheetSchema.nullable().optional(),
  terms: TermsSchema.nullable().optional(),
  planner_state: PlannerStateSchema.nullable().optional(),
  parent_talking_points: PtpSchema.nullable().optional(),
});

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

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const service = createServiceRoleClient();
  const lookup = await service
    .from("lessons")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!lookup.data) {
    return NextResponse.json({ error: "lesson_not_found" }, { status: 404 });
  }

  // Build the patch object excluding undefined keys so we don't NULL
  // out columns the client didn't intend to clear. `null` IS preserved
  // (it's an explicit clear).
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) patch[k] = v;
  }

  const upd = await service
    .from("lessons")
    .update(patch as never)
    .eq("id", id);
  if (upd.error) {
    console.error("[admin/lessons/PATCH] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
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

  const service = createServiceRoleClient();

  // Refuse to delete if any curriculum_slot references this lesson.
  // Curriculum integrity wins over admin tidiness.
  const slotCheck = await service
    .from("curriculum_slots")
    .select("id", { count: "exact", head: true })
    .eq("lesson_id", id);
  if (slotCheck.count && slotCheck.count > 0) {
    return NextResponse.json(
      { error: "lesson_in_use", detail: `Lesson is assigned to ${slotCheck.count} curriculum slot(s).` },
      { status: 409 },
    );
  }

  const del = await service.from("lessons").delete().eq("id", id);
  if (del.error) {
    console.error("[admin/lessons/DELETE] failed", del.error);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
