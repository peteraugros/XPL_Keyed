// /admin/lessons/new
//
// Tim's "Author a new lesson" form. Coach-gated Server Component shell
// that renders the LessonForm Client Component.

import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LessonForm from "./LessonForm";
import styles from "../page.module.css";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

export const dynamic = "force-dynamic";

type CoachLookup = { id: string; is_active: boolean };
type IdLookup = { id: string };

export default async function AdminLessonsNewPage() {
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) redirect("/login?next=/admin/lessons/new");

  const coachLookup = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const coach = coachLookup.data as CoachLookup | null;
  if (!coach || !coach.is_active) {
    const parentRow = await supabase
      .from("parents")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((parentRow.data as IdLookup | null)?.id) redirect("/portal");
    const playerRow = await supabase
      .from("players")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((playerRow.data as IdLookup | null)?.id) redirect("/play");
    redirect("/login?error=no_role");
  }

  return (
    <div className={styles.frame}>
      <a href="/admin/lessons" className={styles.backLink}>Back to library</a>
      <LessonForm />
    </div>
  );
}
