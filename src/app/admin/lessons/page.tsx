// /admin/lessons
//
// Tim's lesson library list. Coach-gated. Lists every authored lesson.
// Big CTA to author a new one at the top.
//
// Status taxonomy (Path B video-first):
//   - PUBLISHED — has video_url + is_published=true
//   - NEEDS VIDEO — is_published=true but video_url is null/empty
//     (these are legacy slide-era rows that haven't been migrated to video)
//   - DRAFT — is_published=false (in-progress planner sessions)
//
// Legacy slide-era stub flag is retired; stub lessons created by old
// Stage C take-on are now just "DRAFT" rows the planner can pick up.

import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import styles from "./page.module.css";
import LessonActionsMenu from "./LessonActionsMenu";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

export const dynamic = "force-dynamic";

type CoachLookup = { id: string; is_active: boolean };
type IdLookup = { id: string };
type LessonRow = {
  id: string;
  title: string;
  fortnite_label: string | null;
  parent_label: string | null;
  topic: string | null;
  difficulty_level: string | null;
  duration_minutes: number | null;
  video_url: string | null;
  is_published: boolean;
  created_at: string;
};

export default async function AdminLessonsPage() {
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) redirect("/login?next=/admin/lessons");

  // Coach gate (no auto-link branch here — /admin handles that on first
  // sign in. If they got to /admin/lessons without /admin first, their
  // coaches.auth_user_id should already be linked.)
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

  const lessonLookup = await supabase
    .from("lessons")
    .select("id, title, fortnite_label, parent_label, topic, difficulty_level, duration_minutes, video_url, is_published, created_at")
    .order("created_at", { ascending: false });
  const lessons = (lessonLookup.data ?? []) as LessonRow[];

  const needsVideoCount = lessons.filter(
    (l) => l.is_published && (!l.video_url || l.video_url.trim() === ""),
  ).length;

  return (
    <div className={styles.frame}>
        <section className={styles.heroBlock}>
          <h1 className={styles.heroTitle}>Lesson library</h1>
          <p className={styles.heroBody}>
            Each lesson is a recorded video plus a beat sheet, a parent
            translation, and a glossary. Plan the lesson with the 7 step
            planner, record the video, paste the URL, publish.
          </p>
          <a href="/admin/lessons/new" className={styles.primaryBtn}>
            + Author a new lesson
          </a>
        </section>

        {needsVideoCount > 0 ? (
          <section className={styles.stubWarning}>
            <div className={styles.stubEyebrow}>
              {needsVideoCount} lesson{needsVideoCount === 1 ? "" : "s"} need{needsVideoCount === 1 ? "s" : ""} a video
            </div>
            <p>
              These were published before the video first switch. Open each and
              paste a video URL at Step 7, or rebuild from scratch through the
              planner. Sunday delivery skips them until they have a video.
            </p>
          </section>
        ) : null}

        <section className={styles.listBlock}>
          {lessons.length === 0 ? (
            <div className={styles.empty}>
              No lessons authored yet. Tap "Author a new lesson" to start.
            </div>
          ) : (
            <ul className={styles.lessonList}>
              {lessons.map((l) => {
                const hasVideo = !!(l.video_url && l.video_url.trim());
                const needsVideo = l.is_published && !hasVideo;
                const isDraft = !l.is_published;
                return (
                  <li key={l.id} className={`${styles.lessonRow} ${needsVideo ? styles.lessonRowStub : ""}`}>
                    <div className={styles.lessonHeader}>
                      <div>
                        <div className={styles.lessonTitle}>{l.title}</div>
                        <div className={styles.lessonSub}>
                          {l.fortnite_label || "(no Fortnite label)"} → {l.parent_label || "(no parent label)"}
                        </div>
                      </div>
                      <div className={styles.lessonHeaderRight}>
                        <div className={styles.lessonBadges}>
                          {l.topic ? <span className={styles.lessonBadge}>{l.topic}</span> : null}
                          {l.difficulty_level ? <span className={styles.lessonBadge}>{l.difficulty_level}</span> : null}
                          {l.duration_minutes ? <span className={styles.lessonBadge}>{l.duration_minutes}m</span> : null}
                          {needsVideo ? (
                            <span className={`${styles.lessonBadge} ${styles.lessonBadgeStub}`}>NEEDS VIDEO</span>
                          ) : l.is_published ? (
                            <span className={`${styles.lessonBadge} ${styles.lessonBadgePublished}`}>PUBLISHED</span>
                          ) : (
                            <span className={styles.lessonBadge}>DRAFT</span>
                          )}
                        </div>
                        <LessonActionsMenu lessonId={l.id} lessonTitle={l.title} />
                      </div>
                    </div>
                    <div className={styles.lessonMeta}>
                      {hasVideo ? "Video on file" : isDraft ? "In planner" : "Awaiting video"}
                      {" · authored "}
                      {new Date(l.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      {" · "}
                      <a href={`/admin/lessons/${l.id}/edit`} className={styles.lessonEditLink}>
                        Open planner
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
    </div>
  );
}
