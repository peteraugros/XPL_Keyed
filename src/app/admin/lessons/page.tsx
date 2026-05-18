// /admin/lessons
//
// Tim's lesson library list. Coach-gated. Lists every authored lesson
// (including stub lessons that came out of the Stage C take-on flow) so
// Tim can see what content exists. Big CTA to author a new one at the
// top.
//
// Stubs surface here too. A stub lesson is one with empty slides=[] —
// it was created automatically when Tim hit "Take Jake on" in the
// Stage C drafter, with a topic + parent translation but no actual
// slide content yet. Tim's job after a take-on: come here and finish
// the lessons before the first paid Sunday delivery fires.

import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import styles from "./page.module.css";

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
  fortnite_label: string;
  parent_label: string;
  topic: string;
  difficulty_level: string;
  duration_minutes: number;
  slides: unknown;
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
    .select("id, title, fortnite_label, parent_label, topic, difficulty_level, duration_minutes, slides, is_published, created_at")
    .order("created_at", { ascending: false });
  const lessons = (lessonLookup.data ?? []) as LessonRow[];

  const stubCount = lessons.filter((l) => {
    const slides = l.slides;
    return Array.isArray(slides) && slides.length === 0;
  }).length;

  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <header className={styles.topBar}>
          <div className={styles.brand}>XPL KEYED ADMIN</div>
          <a href="/admin" className={styles.backLink}>Back to admin</a>
        </header>

        <section className={styles.heroBlock}>
          <h1 className={styles.heroTitle}>Lesson library</h1>
          <p className={styles.heroBody}>
            Each lesson is a set of slide PNGs plus per slide audio, plus a
            parent translation, plus 5 categorized parent talking points. Once
            authored a lesson is reusable across kids in the curriculum drafter.
          </p>
          <a href="/admin/lessons/new" className={styles.primaryBtn}>
            + Author a new lesson
          </a>
        </section>

        {stubCount > 0 ? (
          <section className={styles.stubWarning}>
            <div className={styles.stubEyebrow}>{stubCount} stub lesson{stubCount === 1 ? "" : "s"}</div>
            <p>
              The Stage C "Take on" flow creates stub lessons (no slides yet) so
              the curriculum can ship before content is authored. Finish those
              lessons before the first Sunday delivery for that kid fires, or
              the parent email goes out empty.
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
                const slideCount = Array.isArray(l.slides) ? l.slides.length : 0;
                const isStub = slideCount === 0;
                return (
                  <li key={l.id} className={`${styles.lessonRow} ${isStub ? styles.lessonRowStub : ""}`}>
                    <div className={styles.lessonHeader}>
                      <div>
                        <div className={styles.lessonTitle}>{l.title}</div>
                        <div className={styles.lessonSub}>
                          {l.fortnite_label} → {l.parent_label}
                        </div>
                      </div>
                      <div className={styles.lessonBadges}>
                        <span className={styles.lessonBadge}>{l.topic}</span>
                        <span className={styles.lessonBadge}>{l.difficulty_level}</span>
                        <span className={styles.lessonBadge}>{l.duration_minutes}m</span>
                        {isStub ? (
                          <span className={`${styles.lessonBadge} ${styles.lessonBadgeStub}`}>STUB</span>
                        ) : null}
                        {l.is_published ? (
                          <span className={`${styles.lessonBadge} ${styles.lessonBadgePublished}`}>PUBLISHED</span>
                        ) : (
                          <span className={styles.lessonBadge}>DRAFT</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.lessonMeta}>
                      {slideCount} slide{slideCount === 1 ? "" : "s"} ·
                      authored {new Date(l.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
