// GET /api/admin/lessons/library?player_id=<uuid>
//
// Returns the library of published lessons for the swap-lesson picker.
// Each lesson includes a flag indicating whether THIS player has
// already had it assigned in any curriculum slot (active or completed
// curricula). Tim sees that "already done" badge but isn't blocked —
// expert judgment, may legitimately re-do tunneling if the kid's
// still struggling.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LessonRow = {
  id: string;
  title: string;
  fortnite_label: string;
  parent_label: string;
  topic: string;
  difficulty_level: string;
  duration_minutes: number;
  is_published: boolean;
};

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const playerId = url.searchParams.get("player_id");

  const service = createServiceRoleClient();
  const lessonsResp = await service
    .from("lessons")
    .select("id, title, fortnite_label, parent_label, topic, difficulty_level, duration_minutes, is_published")
    .order("created_at", { ascending: true });
  const lessons = (lessonsResp.data ?? []) as LessonRow[];

  // For each lesson, determine if it's already been assigned to this
  // player. Single query: lessons used in any curriculum_slot whose
  // curriculum belongs to this player.
  const usedLessonIds = new Set<string>();
  if (playerId) {
    const used = await service
      .from("curriculum_slots")
      .select("lesson_id, curricula!inner(player_id)")
      .eq("curricula.player_id", playerId)
      .not("lesson_id", "is", null);
    for (const row of (used.data ?? []) as Array<{ lesson_id: string | null }>) {
      if (row.lesson_id) usedLessonIds.add(row.lesson_id);
    }
  }

  return NextResponse.json({
    lessons: lessons.map((l) => ({
      id: l.id,
      title: l.title,
      fortnite_label: l.fortnite_label,
      parent_label: l.parent_label,
      topic: l.topic,
      difficulty_level: l.difficulty_level,
      duration_minutes: l.duration_minutes,
      is_published: l.is_published,
      already_done: usedLessonIds.has(l.id),
    })),
  });
}
