// POST /api/admin/lessons
//
// Coach-gated. Creates a new draft lesson row in planner-state.
// Returns the new lesson id. /admin/lessons/new immediately redirects
// to /admin/lessons/[id]/edit which renders the planner.
//
// Body is empty (POST with no payload). A draft lesson lands with:
//   - title: "Untitled lesson" (placeholder; the planner derives a
//     real title from the watchNotes.mainGoal as Tim fills it in)
//   - is_published: false
//   - all planner JSONB columns null until the planner writes them
//
// This replaced the original slide-era multipart-upload POST. Slide
// rows that already exist in the DB continue to work; new lessons
// never populate the slides column. The slides column itself gets
// dropped in a follow-up migration once no row references it.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
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
  const coach = coachRow.data as { id: string } | null;
  if (!coach) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  const service = createServiceRoleClient();
  const insert = await service
    .from("lessons")
    .insert({
      author_id: coach.id,
      title: "Untitled lesson",
      is_published: false,
    } as never)
    .select("id")
    .single();

  if (insert.error || !insert.data) {
    console.error("[admin/lessons/POST] insert failed", insert.error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  const row = insert.data as { id: string };
  return NextResponse.json({ ok: true, id: row.id });
}
