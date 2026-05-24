// /admin/lessons/[id]/edit
//
// Coach-gated. Loads the lesson row (planner-era fields) and hands off
// to PlannerClient. The 7-step planner UI lives in the client
// component; this server shell just authenticates + fetches + 404s.

import { requireCoachSession } from "../../../_lib/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import PlannerClient, { type LessonRecord } from "./PlannerClient";

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
  is_published: boolean;
  video_url: string | null;
  beat_sheet: unknown;
  terms: unknown;
  planner_state: unknown;
  parent_talking_points: unknown;
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
      "id, title, fortnite_label, parent_label, parent_skill_description, topic, difficulty_level, duration_minutes, is_published, video_url, beat_sheet, terms, planner_state, parent_talking_points",
    )
    .eq("id", id)
    .maybeSingle();
  const row = lookup.data as DbLessonRow | null;
  if (!row) notFound();

  const initial: LessonRecord = {
    id: row.id,
    title: row.title,
    fortniteLabel: row.fortnite_label,
    parentLabel: row.parent_label,
    parentSkillDescription: row.parent_skill_description,
    topic: row.topic,
    difficultyLevel: row.difficulty_level,
    durationMinutes: row.duration_minutes,
    isPublished: row.is_published,
    videoUrl: row.video_url,
    beatSheet: (row.beat_sheet as LessonRecord["beatSheet"]) ?? null,
    terms: (row.terms as LessonRecord["terms"]) ?? null,
    plannerState: (row.planner_state as LessonRecord["plannerState"]) ?? null,
    parentTalkingPoints:
      (row.parent_talking_points as LessonRecord["parentTalkingPoints"]) ?? null,
  };

  return <PlannerClient initial={initial} />;
}
