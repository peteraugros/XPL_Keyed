// /admin/lessons/[id]/edit
//
// Coach-gated. Fetches the lesson row, renders LessonEditForm with
// existing values populated. Edit covers all text fields; media
// (slide images + audio) is not editable here — Tim re-authors a fresh
// lesson via /admin/lessons/new for new media.

import { requireCoachSession } from "../../../_lib/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import LessonEditForm from "./LessonEditForm";

export const dynamic = "force-dynamic";

type SlideRow = {
  position?: number;
  image_url?: string | null;
  audio_url?: string | null;
  speaker_notes?: string;
};
type PtpRow = { category: string; text: string };
type LessonRow = {
  id: string;
  title: string;
  fortnite_label: string;
  parent_label: string;
  parent_skill_description: string;
  topic: string;
  difficulty_level: string;
  duration_minutes: number;
  is_published: boolean;
  slides: SlideRow[] | null;
  parent_talking_points: PtpRow[] | null;
};

export default async function LessonEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCoachSession();
  const { id } = await params;

  const service = createServiceRoleClient();
  const lookup = await service
    .from("lessons")
    .select(
      "id, title, fortnite_label, parent_label, parent_skill_description, topic, difficulty_level, duration_minutes, is_published, slides, parent_talking_points",
    )
    .eq("id", id)
    .maybeSingle();
  const lesson = lookup.data as LessonRow | null;
  if (!lesson) notFound();

  return (
    <LessonEditForm
      lessonId={lesson.id}
      initial={{
        title: lesson.title,
        fortnite_label: lesson.fortnite_label,
        parent_label: lesson.parent_label,
        parent_skill_description: lesson.parent_skill_description,
        topic: lesson.topic,
        difficulty_level: lesson.difficulty_level,
        duration_minutes: lesson.duration_minutes,
        is_published: lesson.is_published,
        slides: lesson.slides ?? [],
        parent_talking_points: lesson.parent_talking_points ?? [],
      }}
    />
  );
}
