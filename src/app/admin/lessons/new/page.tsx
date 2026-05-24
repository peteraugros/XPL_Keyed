// /admin/lessons/new
//
// Server-side entry point for authoring a new lesson. Creates a fresh
// draft row, then redirects to /admin/lessons/[id]/edit which renders
// the 7-step planner. Keeps the URL space clean: every lesson (draft
// or published) lives at a stable /admin/lessons/[id]/edit URL.

import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewLessonRedirect() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/login?next=/admin/lessons/new" as never);
  }
  const coachRow = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  const coach = coachRow.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    redirect("/login?error=no_role" as never);
  }

  // Bypass the HTTP endpoint and insert directly. Cookie-forwarded
  // fetch() against our own /api/admin/lessons would round-trip through
  // the auth middleware again here for nothing.
  //
  // We seed every column that used to be NOT NULL with a placeholder
  // value. This keeps the insert working whether or not the
  // 20260524000000_lessons_video_planner.sql migration has been
  // applied yet. Once the migration is applied the planner clears
  // these as Tim fills in the real values.
  const service = createServiceRoleClient();
  const insert = await service
    .from("lessons")
    .insert({
      author_id: coach.id,
      title: "Untitled lesson",
      is_published: false,
      fortnite_label: "",
      parent_label: "",
      parent_skill_description: "",
      topic: "game_sense",
      difficulty_level: "beginner",
      duration_minutes: 1,
      slides: [],
      parent_talking_points: [],
    } as never)
    .select("id")
    .single();

  if (insert.error || !insert.data) {
    console.error("[admin/lessons/new] insert failed", insert.error);
    redirect("/admin/lessons?error=create_failed" as never);
  }

  const row = insert.data as { id: string };
  redirect(`/admin/lessons/${row.id}/edit` as never);
}
