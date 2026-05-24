// /play/library — kid's lesson library.
//
// State-aware:
//   * trial    -> locked, with a clear "this is what it unlocks" preview.
//   * active   -> the 4-week plan with per-week status (dropped or
//                 coming, mirrors the cycle counter).
//   * paused   -> "on hold" copy, weeks visible but with a pause badge.
//   * ended    -> historical: shows the last cycle's plan if any.
//
// Lesson detail view (open a week, watch slides + voiceover) is a future
// build — needs the slide viewer + signed URL minting. Not in scope here.

import { requirePlayerSession } from "../_lib/session";
import styles from "../_components/inner-page.module.css";

export const dynamic = "force-dynamic";

type SubLookup = {
  status: string;
  cycle_lessons_delivered: number;
};
type CurriculumLookup = { id: string };
type SlotLookup = {
  week_number: number;
  is_vod_review: boolean;
  lesson_id: string | null;
  delivered_at: string | null;
};
type LessonLookup = {
  id: string;
  fortnite_label: string;
  video_url: string | null;
};

export default async function LibraryPage() {
  const { supabase, player } = await requirePlayerSession();

  const [subResp, curriculumResp] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("status, cycle_lessons_delivered")
      .eq("player_id", player.id)
      .maybeSingle(),
    supabase
      .from("curricula")
      .select("id")
      .eq("player_id", player.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const sub = subResp.data as SubLookup | null;
  const curriculum = curriculumResp.data as CurriculumLookup | null;

  let slots: SlotLookup[] = [];
  const lessonById = new Map<string, LessonLookup>();
  if (curriculum) {
    const slotResp = await supabase
      .from("curriculum_slots")
      .select("week_number, is_vod_review, lesson_id, delivered_at")
      .eq("curriculum_id", curriculum.id)
      .order("week_number", { ascending: true });
    slots = (slotResp.data ?? []) as SlotLookup[];
    const lessonIds = slots.map((s) => s.lesson_id).filter((id): id is string => !!id);
    if (lessonIds.length > 0) {
      const lessonResp = await supabase
        .from("lessons")
        .select("id, fortnite_label, video_url")
        .in("id", lessonIds);
      for (const l of (lessonResp.data ?? []) as LessonLookup[]) {
        lessonById.set(l.id, l);
      }
    }
  }

  const phase =
    sub?.status === "active"
      ? "active"
      : sub?.status === "past_due" || sub?.status === "pending_cancel"
        ? "paused"
        : sub?.status === "canceled" || sub?.status === "declined"
          ? "ended"
          : "trial";

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Library</div>
        <h1 className={styles.title}>Lesson library</h1>
        <p className={styles.intro}>
          {phase === "active"
            ? "Tim drops a lesson every Sunday. Watch when you have time before the live call that week."
            : phase === "paused"
              ? "Library is paused. Lessons will resume when your subscription is back."
              : phase === "ended"
                ? "Library is closed. Your past lessons stay here for reference."
                : "Locked until your first paid cycle starts. Here is what it looks like."}
        </p>
      </section>

      {phase === "trial" ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Coming after conversion</div>
          <h2 className={styles.cardTitle}>What unlocks here</h2>
          <p className={styles.cardBody}>
            After Tim takes you on and your parents subscribe, every Sunday
            a fresh lesson lands here. Slides plus a voiceover from Tim
            walking you through it. Mid week you have the live 30 minute
            call on Discord. Repeat for 4 weeks per cycle.
          </p>
        </section>
      ) : slots.length === 4 ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>
            {phase === "active" ? "Your 4 week plan" : "Most recent plan"}
          </div>
          <h2 className={styles.cardTitle}>What Tim is teaching</h2>
          <ul className={styles.weekList}>
            {slots.map((s) => {
              const lesson = s.lesson_id ? lessonById.get(s.lesson_id) ?? null : null;
              const label = s.is_vod_review
                ? "VOD review"
                : lesson?.fortnite_label ?? "Coming";
              const done = !!s.delivered_at;
              const videoUrl = lesson?.video_url ?? null;
              return (
                <li key={s.week_number} className={styles.weekRow}>
                  <span className={styles.weekNum}>Wk {s.week_number}</span>
                  <span className={styles.weekLabel}>
                    {label}
                    {done && videoUrl ? (
                      <>
                        {" · "}
                        <a
                          href={videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.watchLink}
                        >
                          Watch →
                        </a>
                      </>
                    ) : null}
                  </span>
                  <span
                    className={`${styles.weekStatus} ${done ? styles.weekStatusDone : ""}`}
                  >
                    {done ? "Dropped" : phase === "paused" ? "Paused" : "Coming"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Empty</div>
          <h2 className={styles.cardTitle}>No lessons yet</h2>
          <p className={styles.cardBody}>
            Your past curriculum is saved on Tim&apos;s side. If you restart,
            new weeks will land here.
          </p>
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>How a lesson works</div>
        <ul className={styles.weekList}>
          <li className={styles.weekRow}>
            <span className={styles.weekNum}>1</span>
            <span className={styles.weekLabel}>
              Tim drops slides plus a voiceover here on Sunday.
            </span>
            <span />
          </li>
          <li className={styles.weekRow}>
            <span className={styles.weekNum}>2</span>
            <span className={styles.weekLabel}>
              You watch when you have time before the live call.
            </span>
            <span />
          </li>
          <li className={styles.weekRow}>
            <span className={styles.weekNum}>3</span>
            <span className={styles.weekLabel}>
              Mid week, 30 min live call on Discord. Tim watches you play.
            </span>
            <span />
          </li>
          <li className={styles.weekRow}>
            <span className={styles.weekNum}>4</span>
            <span className={styles.weekLabel}>
              Repeat for 4 weeks. Then the next cycle starts.
            </span>
            <span />
          </li>
        </ul>
      </section>
    </div>
  );
}
