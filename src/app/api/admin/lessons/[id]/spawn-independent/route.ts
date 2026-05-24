// POST /api/admin/lessons/[id]/spawn-independent
//
// Standard Mode counterpart to /spawn-series. Spawns N draft lesson
// stubs from the planner's identifyList. Crucial differences from
// the capstone version:
//
//   - NO series_id bound. Each spawned lesson stands alone in the
//     library — no PART X/N badges, no blue border, no implied
//     order. That's the structural meaning of "independent skills."
//   - The current lesson stays as-is (it'll be planned through Step
//     5+ as one of the N independent lessons via the narrowChoice).
//
// Excludes the lesson that Tim picked at Step 4 (narrowChoice) from
// the spawn list — he's planning that one in the current planner
// session. Spawning a duplicate would be confusing.
//
// Idempotency: marks spawned lesson ids in
// planner_state.spawnedIndependentLessonIds so re-clicks see the
// already-done state and don't create duplicates.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IdentifyItem = { id: string; name: string; description?: string };
type PlannerState = {
  identifyList?: IdentifyItem[];
  narrowChoice?: string | null;
  spawnedIndependentLessonIds?: string[];
  [k: string]: unknown;
};

type SourceRow = {
  id: string;
  author_id: string;
  planner_state: PlannerState | null;
};

function newPlannerState(itemName: string, itemDescription: string): PlannerState {
  return {
    currentStep: 1,
    roughDraft: "",
    watchNotes: { clipDescription: "", mainGoal: itemName },
    identifyList: [
      { id: "i_" + crypto.randomBytes(4).toString("hex"), name: itemName, description: itemDescription },
      { id: "i_" + crypto.randomBytes(4).toString("hex"), name: "", description: "" },
    ],
    isCapstone: false,
    dependencyAnswered: false,
    narrowChoice: null,
    curriculumOrder: null,
    assumesPrerequisites: false,
    reviewChecks: { oneIdea: false, definitions: false, why: false, pacing: false },
  } as PlannerState;
}

export async function POST(
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
    .select("id, is_active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  const coach = coachRow.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  const service = createServiceRoleClient();
  const lookup = await service
    .from("lessons")
    .select("id, author_id, planner_state")
    .eq("id", id)
    .maybeSingle();
  const source = lookup.data as SourceRow | null;
  if (!source) {
    return NextResponse.json({ error: "lesson_not_found" }, { status: 404 });
  }

  const ps = source.planner_state ?? null;
  const items = Array.isArray(ps?.identifyList) ? ps.identifyList : [];
  const narrowChoice = ps?.narrowChoice ?? null;
  // Exclude the lesson Tim's actively planning here.
  const toSpawn = items.filter((it) => it.name?.trim() && it.id !== narrowChoice);
  if (toSpawn.length === 0) {
    return NextResponse.json(
      { error: "nothing_to_spawn", detail: "No identified skills left to spawn (other than the one you're planning now)." },
      { status: 400 },
    );
  }

  // Idempotency: if we've already spawned the standalone set, no-op.
  const alreadySpawned = Array.isArray(ps?.spawnedIndependentLessonIds)
    ? ps!.spawnedIndependentLessonIds!.length > 0
    : false;
  if (alreadySpawned) {
    return NextResponse.json(
      { error: "already_spawned", existing_ids: ps!.spawnedIndependentLessonIds },
      { status: 409 },
    );
  }

  const insertedIds: string[] = [];
  for (const item of toSpawn) {
    const childInsert = await service
      .from("lessons")
      .insert({
        author_id: source.author_id,
        title: item.name,
        fortnite_label: item.name,
        parent_label: "",
        parent_skill_description: "",
        topic: "game_sense",
        difficulty_level: "beginner",
        duration_minutes: 1,
        is_published: false,
        slides: [],
        parent_talking_points: [],
        // NO series_id, NO series_position. Independent.
        planner_state: newPlannerState(item.name, item.description ?? ""),
      } as never)
      .select("id")
      .single();
    if (childInsert.error || !childInsert.data) {
      console.error("[spawn-independent] child insert failed", childInsert.error);
      if (insertedIds.length > 0) {
        await service.from("lessons").delete().in("id", insertedIds);
      }
      return NextResponse.json({ error: "spawn_failed" }, { status: 500 });
    }
    const row = childInsert.data as { id: string };
    insertedIds.push(row.id);
  }

  // Mark spawned in the source planner_state so the UI can show the
  // already-done state on subsequent visits.
  const newPs: PlannerState = {
    ...(ps ?? {}),
    spawnedIndependentLessonIds: insertedIds,
  };
  await service
    .from("lessons")
    .update({ planner_state: newPs } as never)
    .eq("id", source.id);

  return NextResponse.json({ ok: true, created_ids: insertedIds });
}
