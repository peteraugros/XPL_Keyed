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
    console.error("[admin/lessons/new] insert failed", insert.error);
    redirect("/admin/lessons" as never);
  }

  const row = insert.data as { id: string };
  redirect(`/admin/lessons/${row.id}/edit` as never);
}
