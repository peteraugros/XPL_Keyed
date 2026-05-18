// POST /api/admin/lessons
//
// Coach-gated. Accepts multipart/form-data:
//   * Metadata fields: title, fortnite_label, parent_label,
//     parent_skill_description, topic, difficulty_level, duration_minutes,
//     is_published.
//   * Slide rows: indexed slide_{i}_image (File), slide_{i}_audio (File),
//     slide_{i}_notes (string). i = 0..slide_count-1.
//   * Parent talking points: ptp_<category> for each of the 5 categories.
//
// What this does:
//   1. Insert the lesson row with empty slides=[] + talking points so we
//      can write files under lessons/<lesson_id>/...
//   2. Upload each slide PNG + audio MP3 to lesson-assets bucket using
//      the service-role storage client.
//   3. Build the slides JSONB array and parent_talking_points JSONB
//      array; UPDATE the lesson row with the final shape.
//
// Why two-phase write: we need the lesson id to scope storage paths.
// Could pre-generate a UUID instead of insert-then-update, but the two-
// phase approach also auto-cleans-up if uploads fail mid-way (the partial
// lesson row exists with empty slides; future re-author replaces it).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { TablesInsert, TablesUpdate } from "@/types/db";

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
const PTP_CATEGORIES = [
  "informed_observer",
  "co_conspirator",
  "cultural_literacy",
  "good_question",
  "strategic_note",
] as const;

const MetadataSchema = z.object({
  title: z.string().trim().min(1).max(160),
  fortnite_label: z.string().trim().min(1).max(120),
  parent_label: z.string().trim().min(1).max(180),
  parent_skill_description: z.string().trim().min(1).max(500),
  topic: z.enum(TOPICS),
  difficulty_level: z.enum(DIFFICULTIES),
  duration_minutes: z.number().int().min(1).max(120),
  is_published: z.boolean(),
});

export async function POST(req: Request) {
  // ---- 0. Auth gate -------------------------------------------------------
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const coachLookup = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // ---- 1. Parse + validate form data -------------------------------------
  const form = await req.formData();

  let meta: z.infer<typeof MetadataSchema>;
  try {
    meta = MetadataSchema.parse({
      title: form.get("title"),
      fortnite_label: form.get("fortnite_label"),
      parent_label: form.get("parent_label"),
      parent_skill_description: form.get("parent_skill_description"),
      topic: form.get("topic"),
      difficulty_level: form.get("difficulty_level"),
      duration_minutes: Number(form.get("duration_minutes")),
      is_published: form.get("is_published") === "true",
    });
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_metadata", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const slideCount = Number(form.get("slide_count") ?? 0);
  if (!Number.isInteger(slideCount) || slideCount < 1 || slideCount > 60) {
    return NextResponse.json({ error: "invalid_slide_count" }, { status: 400 });
  }

  // Collect slide rows.
  type SlideInput = {
    image: File | null;
    audio: File | null;
    notes: string;
  };
  const slides: SlideInput[] = [];
  for (let i = 0; i < slideCount; i++) {
    const image = form.get(`slide_${i}_image`);
    const audio = form.get(`slide_${i}_audio`);
    const notes = String(form.get(`slide_${i}_notes`) ?? "").trim();
    slides.push({
      image: image instanceof File && image.size > 0 ? image : null,
      audio: audio instanceof File && audio.size > 0 ? audio : null,
      notes,
    });
  }
  if (slides.length < 1) {
    return NextResponse.json({ error: "no_slides" }, { status: 400 });
  }
  // Each slide must have at least an image. Audio is optional for MVP.
  for (let i = 0; i < slides.length; i++) {
    if (!slides[i].image) {
      return NextResponse.json(
        { error: "slide_missing_image", slide_index: i },
        { status: 400 },
      );
    }
  }

  // Parent talking points: required per category.
  const ptpEntries: { category: string; text: string }[] = [];
  for (const cat of PTP_CATEGORIES) {
    const text = String(form.get(`ptp_${cat}`) ?? "").trim();
    if (text.length === 0) {
      return NextResponse.json(
        { error: "missing_parent_talking_point", category: cat },
        { status: 400 },
      );
    }
    ptpEntries.push({ category: cat, text });
  }

  // ---- 2. Insert lesson row (with empty slides; we fill after upload) ----
  const insertRow: TablesInsert<"lessons"> = {
    author_id: coach.id,
    title: meta.title,
    fortnite_label: meta.fortnite_label,
    parent_label: meta.parent_label,
    parent_skill_description: meta.parent_skill_description,
    topic: meta.topic,
    difficulty_level: meta.difficulty_level,
    duration_minutes: meta.duration_minutes,
    slides: [],
    parent_talking_points: ptpEntries,
    is_published: meta.is_published,
  };
  const lessonInsert = await supabase
    .from("lessons")
    .insert(insertRow as never)
    .select("id")
    .single();
  const lessonData = lessonInsert.data as { id: string } | null;
  if (lessonInsert.error || !lessonData) {
    console.error("[admin/lessons] insert failed", lessonInsert.error);
    return NextResponse.json({ error: "lesson_insert_failed" }, { status: 500 });
  }
  const lessonId = lessonData.id;

  // ---- 3. Upload slide assets to storage ---------------------------------
  // Service-role client for storage writes. Coach RLS would also permit
  // (lesson_assets_coach_all), but the cookie-bound supabase client's
  // storage helper sometimes mishandles streams; service-role is sturdier.
  const admin = createServiceRoleClient();
  type SlideOutput = {
    position: number;
    image_url: string;
    audio_url: string | null;
    speaker_notes: string;
  };
  const slideOutputs: SlideOutput[] = [];

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const position = i + 1;
    if (!s.image) continue; // unreachable per the earlier check
    const imageExt = extFromFile(s.image, "png");
    const imagePath = `lessons/${lessonId}/slide-${position}.${imageExt}`;
    const imageBuf = Buffer.from(await s.image.arrayBuffer());
    const imageUpload = await admin.storage.from("lesson-assets").upload(imagePath, imageBuf, {
      contentType: s.image.type || "image/png",
      upsert: true,
    });
    if (imageUpload.error) {
      console.error("[admin/lessons] image upload failed", imageUpload.error);
      return NextResponse.json({ error: "image_upload_failed", slide_index: i }, { status: 500 });
    }

    let audioPath: string | null = null;
    if (s.audio) {
      const audioExt = extFromFile(s.audio, "mp3");
      audioPath = `lessons/${lessonId}/slide-${position}.${audioExt}`;
      const audioBuf = Buffer.from(await s.audio.arrayBuffer());
      const audioUpload = await admin.storage.from("lesson-assets").upload(audioPath, audioBuf, {
        contentType: s.audio.type || "audio/mpeg",
        upsert: true,
      });
      if (audioUpload.error) {
        console.error("[admin/lessons] audio upload failed", audioUpload.error);
        return NextResponse.json({ error: "audio_upload_failed", slide_index: i }, { status: 500 });
      }
    }

    slideOutputs.push({
      position,
      image_url: imagePath,
      audio_url: audioPath,
      speaker_notes: s.notes,
    });
  }

  // ---- 4. UPDATE the lesson with the final slides JSONB ------------------
  const patch: TablesUpdate<"lessons"> = { slides: slideOutputs };
  const updateResult = await supabase
    .from("lessons")
    .update(patch as never)
    .eq("id", lessonId);
  if (updateResult.error) {
    console.error("[admin/lessons] slides update failed", updateResult.error);
    return NextResponse.json({ error: "slides_update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lesson_id: lessonId });
}

function extFromFile(file: File, fallback: string): string {
  const name = file.name ?? "";
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") || fallback;
  }
  return fallback;
}
