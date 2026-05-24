// /admin/lessons/[id]/preview
//
// Coach-gated preview of what a student / parent sees when this
// lesson lands. Fetches the lesson row and hands off to PreviewClient
// which renders LessonView with a kid/parent toggle.
//
// Distinct from /admin/lessons/[id]/edit which renders the planner.
// The library row "Published" lessons land here by default; "Drafts"
// land in the planner. Either action is always reachable from this
// page via the "Edit lesson" link in the top bar.

import { requireCoachSession } from "../../../_lib/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";
import type { LessonForView } from "./LessonView";

export const dynamic = "force-dynamic";

type DbLessonRow = {
  id: string;
  title: string;
  fortnite_label: string | null;
  parent_label: string | null;
  parent_skill_description: string | null;
  topic: string | null;
  difficulty_level: string | null;
  duration_minutes: number | null;
  video_url: string | null;
  beat_sheet: unknown;
  terms: unknown;
  parent_talking_points: unknown;
};

export default async function LessonPreviewPage({
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
      "id, title, fortnite_label, parent_label, parent_skill_description, topic, difficulty_level, duration_minutes, video_url, beat_sheet, terms, parent_talking_points",
    )
    .eq("id", id)
    .maybeSingle();
  const row = lookup.data as DbLessonRow | null;
  if (!row) notFound();

  const lesson: LessonForView = {
    id: row.id,
    title: row.title,
    fortniteLabel: row.fortnite_label,
    parentLabel: row.parent_label,
    parentSkillDescription: row.parent_skill_description,
    topic: row.topic,
    difficultyLevel: row.difficulty_level,
    durationMinutes: row.duration_minutes,
    videoUrl: row.video_url,
    beatSheet: (row.beat_sheet as LessonForView["beatSheet"]) ?? null,
    terms: (row.terms as LessonForView["terms"]) ?? null,
    parentTalkingPoints:
      (row.parent_talking_points as LessonForView["parentTalkingPoints"]) ?? null,
  };

  return <PreviewClient lesson={lesson} />;
}
