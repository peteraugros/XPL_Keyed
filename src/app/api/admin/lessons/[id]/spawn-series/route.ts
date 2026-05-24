// POST /api/admin/lessons/[id]/spawn-series
//
// Coach-gated. Capstone Mode follow-on: given a lesson with
// planner_state.curriculumOrder + identifyList populated (Tim went
// through Step 3 → Step 4 Capstone Mode), spawns N stub lessons —
// one per foundation skill — and binds them all to the capstone via
// series_id + series_position. Idempotent: re-running while children
// already exist no-ops with a 409 + the existing ids.
//
// Prefill per child lesson:
//   - title = the identify item's name
//   - fortnite_label = same
//   - planner_state.currentStep = 1 (Tim starts at rough draft)
//   - planner_state.watchNotes.mainGoal = item.name (gives Step 2 a head start)
//   - planner_state.identifyList = [{ id, name: item.name, description }]
//     (just the one skill — keeps Step 3 from feeling blank)
//   - All other planner state defaults
//   - is_published = false
//   - series_id = capstone.id
//   - series_position = 1..N
//
// Capstone row gets its own series_id = its id + series_position = N+1
// so a lookup "all lessons in this series" finds everyone.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IdentifyItem = { id: string; name: string; description?: string };
type PlannerState = {
  currentStep?: number;
  curriculumOrder?: string[] | null;
  identifyList?: IdentifyItem[];
  isCapstone?: boolean;
  [k: string]: unknown;
};

type CapstoneRow = {
  id: string;
  author_id: string;
  series_id: string | null;
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
  };
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
    .select("id, author_id, series_id, planner_state")
    .eq("id", id)
    .maybeSingle();
  const capstone = lookup.data as CapstoneRow | null;
  if (!capstone) {
    return NextResponse.json({ error: "lesson_not_found" }, { status: 404 });
  }

  const ps = capstone.planner_state ?? null;
  const order = Array.isArray(ps?.curriculumOrder) ? ps.curriculumOrder : [];
  const items = Array.isArray(ps?.identifyList) ? ps.identifyList : [];
  if (order.length < 2 || items.length < 2) {
    return NextResponse.json(
      { error: "no_series_data", detail: "This lesson hasn't gone through Step 4 Capstone Mode yet." },
      { status: 400 },
    );
  }

  // Idempotency: if children already exist, just return them.
  if (capstone.series_id === capstone.id) {
    // series_id / series_position columns were added in
    // 20260524000100_lesson_series.sql and aren't in the regenerated
    // db.ts types yet. Cast through `as never` until next gen:types
    // run; behavior is correct at runtime.
    const existing = await service
      .from("lessons")
      .select("id, series_position, title")
      .eq("series_id" as never, capstone.id)
      .neq("id", capstone.id)
      .order("series_position" as never, { ascending: true });
    return NextResponse.json(
      {
        ok: false,
        error: "already_spawned",
        existing: existing.data ?? [],
      },
      { status: 409 },
    );
  }

  const ordered: IdentifyItem[] = order
    .map((itemId) => items.find((it) => it.id === itemId))
    .filter((it): it is IdentifyItem => !!it && !!it.name?.trim());
  if (ordered.length < 2) {
    return NextResponse.json(
      { error: "no_named_items", detail: "Need at least 2 named items in the capstone plan." },
      { status: 400 },
    );
  }

  // Spawn N children + bind the capstone into the series.
  const insertedIds: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    const childInsert = await service
      .from("lessons")
      .insert({
        author_id: capstone.author_id,
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
        series_id: capstone.id,
        series_position: i + 1,
        planner_state: newPlannerState(item.name, item.description ?? ""),
      } as never)
      .select("id")
      .single();
    if (childInsert.error || !childInsert.data) {
      console.error("[spawn-series] child insert failed", childInsert.error);
      // Best-effort partial rollback: delete any children we've created so far.
      if (insertedIds.length > 0) {
        await service.from("lessons").delete().in("id", insertedIds);
      }
      return NextResponse.json({ error: "spawn_failed" }, { status: 500 });
    }
    const row = childInsert.data as { id: string };
    insertedIds.push(row.id);
  }

  // Bind the capstone into the series at position N+1.
  const capstoneUpdate = await service
    .from("lessons")
    .update({
      series_id: capstone.id,
      series_position: ordered.length + 1,
    } as never)
    .eq("id", capstone.id);
  if (capstoneUpdate.error) {
    console.error("[spawn-series] capstone bind failed", capstoneUpdate.error);
    // Children exist, capstone unbound. Worth telling Tim — the children
    // are recoverable from the library, and re-running spawn will find
    // them existing (via the 409 branch above).
    return NextResponse.json(
      { error: "capstone_bind_failed", created_ids: insertedIds },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, created_ids: insertedIds });
}
