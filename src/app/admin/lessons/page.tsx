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
import BundlesTab from "./BundlesTab";

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
  series_id: string | null;
  series_position: number | null;
  bundle_id: string | null;
  bundle_position: number | null;
};

type Tab = "published" | "drafts" | "bundles";

export default async function AdminLessonsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab: Tab =
    tabParam === "drafts" || tabParam === "bundles"
      ? (tabParam as Tab)
      : "published";

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
    .select("id, title, fortnite_label, parent_label, topic, difficulty_level, duration_minutes, video_url, is_published, created_at, series_id, series_position, bundle_id, bundle_position")
    .order("created_at", { ascending: false });
  const allLessons = (lessonLookup.data ?? []) as LessonRow[];

  // Bundles + their member lessons (for the Bundles tab).
  const bundleLookup = await supabase
    .from("lesson_bundles" as never)
    .select("id, title, description, is_published, created_at, updated_at")
    .order("updated_at", { ascending: false });
  const bundles = (bundleLookup.data ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    is_published: boolean;
    created_at: string;
    updated_at: string;
  }>;

  // Tab counts ALWAYS computed against the full list so the tab labels
  // don't get out of sync with the filter. visibleLessons is the tab-
  // filtered list rendered below.
  const publishedCount = allLessons.filter((l) => l.is_published).length;
  const draftsCount = allLessons.filter((l) => !l.is_published).length;
  const needsVideoCount = allLessons.filter(
    (l) => l.is_published && (!l.video_url || l.video_url.trim() === ""),
  ).length;

  const visibleLessons =
    tab === "published"
      ? allLessons.filter((l) => l.is_published)
      : tab === "drafts"
        ? allLessons.filter((l) => !l.is_published)
        : []; // bundles tab is a different content shape (see render)

  // Kept for legacy `lessons` references below; rename to clarify.
  const lessons = visibleLessons;

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

        <nav className={styles.tabNav} aria-label="Lesson library tabs">
          <a
            href="/admin/lessons?tab=published"
            className={`${styles.tab} ${tab === "published" ? styles.tabActive : ""}`}
            aria-current={tab === "published" ? "page" : undefined}
          >
            Published <span className={styles.tabCount}>{publishedCount}</span>
          </a>
          <a
            href="/admin/lessons?tab=drafts"
            className={`${styles.tab} ${tab === "drafts" ? styles.tabActive : ""}`}
            aria-current={tab === "drafts" ? "page" : undefined}
          >
            Drafts <span className={styles.tabCount}>{draftsCount}</span>
          </a>
          <a
            href="/admin/lessons?tab=bundles"
            className={`${styles.tab} ${tab === "bundles" ? styles.tabActive : ""}`}
            aria-current={tab === "bundles" ? "page" : undefined}
          >
            Bundles
          </a>
        </nav>

        {tab === "bundles" ? (
          <BundlesTab
            bundles={bundles}
            allLessons={allLessons.map((l) => ({
              id: l.id,
              title: l.title,
              is_published: l.is_published,
              bundle_id: l.bundle_id,
              bundle_position: l.bundle_position,
            }))}
          />
        ) : null}

        {tab === "published" && needsVideoCount > 0 ? (
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

        {tab !== "bundles" ? (
        <section className={styles.listBlock}>
          {lessons.length === 0 ? (
            <div className={styles.empty}>
              {tab === "drafts"
                ? "No drafts. In-progress planner sessions live here."
                : "No published lessons yet. Author one and publish it at Step 7."}
            </div>
          ) : (
            <ul className={styles.lessonList}>
              {lessons.map((l) => {
                const hasVideo = !!(l.video_url && l.video_url.trim());
                const needsVideo = l.is_published && !hasVideo;
                const isDraft = !l.is_published;
                const isInSeries = !!l.series_id;
                const isCapstone = isInSeries && l.series_id === l.id;
                // series total = max series_position among siblings.
                const seriesTotal = isInSeries
                  ? Math.max(
                      ...lessons
                        .filter((sib) => sib.series_id === l.series_id)
                        .map((sib) => sib.series_position ?? 0),
                    )
                  : 0;
                return (
                  <li
                    key={l.id}
                    className={`${styles.lessonRow} ${needsVideo ? styles.lessonRowStub : ""} ${isInSeries && !isCapstone ? styles.lessonRowSeries : ""}`}
                  >
                    <div className={styles.lessonHeader}>
                      <div>
                        <div className={styles.lessonTitle} title={l.title}>{l.title}</div>
                        <div
                          className={styles.lessonSub}
                          title={`${l.fortnite_label ?? ""} → ${l.parent_label ?? ""}`}
                        >
                          {l.fortnite_label || "(no Fortnite label)"} → {l.parent_label || "(no parent label)"}
                        </div>
                      </div>
                      <div className={styles.lessonHeaderRight}>
                        <div className={styles.lessonBadges}>
                          {isInSeries ? (
                            <span className={`${styles.lessonBadge} ${styles.lessonBadgeSeries}`}>
                              {isCapstone
                                ? `CAPSTONE · ${seriesTotal}/${seriesTotal}`
                                : `PART ${l.series_position}/${seriesTotal}`}
                            </span>
                          ) : null}
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
        ) : null}
    </div>
  );
}
