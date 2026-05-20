// /portal/progress
//
// Parent-facing program view. Shows what's been done, what's coming,
// and where the kid started. Surfaces only data we actually have today
// (cycles + slots + lesson labels + the trial Q2 goal); items that
// need new schema (rank-over-time, per-lesson coach notes, milestones)
// stay in the deferred footer so parents see them as on the roadmap.

import { requireParentSession } from "../_lib/session";
import Link from "next/link";
import styles from "../_components/inner-page.module.css";
import progressStyles from "./progress.module.css";

export const dynamic = "force-dynamic";

type SubLookup = {
  id: string;
  status: string;
  lifecycle_state: string;
  cycle_lessons_delivered: number;
  cycle_skips_used: number;
  cycle_started_at: string | null;
  auto_renew_enabled: boolean;
};

type CurriculumLookup = {
  id: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  personalization_note: string | null;
  cycle_anchor_at: string | null;
};

type SlotLookup = {
  id: string;
  curriculum_id: string;
  week_number: number;
  is_vod_review: boolean;
  lesson_id: string | null;
  live_call_at: string | null;
  live_call_event_id: string | null;
  live_call_completed_at: string | null;
  no_show_at: string | null;
  delivered_at: string | null;
  coach_note: string | null;
  coach_note_at: string | null;
};

type LessonLookup = {
  id: string;
  fortnite_label: string;
  parent_label: string;
  parent_skill_description: string;
};

type PrepLookup = {
  q2_choice: string;
  q2_other_text: string | null;
  q3_reflection: string;
};

const Q2_GOALS: Record<string, string> = {
  stop_dying: "stop dying so fast",
  beat_friends: "beat friends consistently",
  hit_unreal: "hit Unreal",
  top_10k_cashcup: "reach the top 10K in a Cash Cup",
  fncs: "make it to FNCS",
  prize_money: "win prize money in competitive play",
  other: "build a more specific goal with Tim",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  const timeRaw = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  const timePart = timeRaw.replace(/\s?(AM|PM)/i, (_m, ap: string) =>
    ap.toLowerCase(),
  );
  return `${datePart} at ${timePart}`;
}

type SlotStatus =
  | { kind: "completed"; at: string }
  | { kind: "delivered"; at: string }
  | { kind: "upcoming"; at: string }
  | { kind: "no_show"; at: string }
  | { kind: "unscheduled" };

function classifySlot(slot: SlotLookup, nowMs: number): SlotStatus {
  if (slot.no_show_at) return { kind: "no_show", at: slot.no_show_at };
  if (slot.live_call_completed_at)
    return { kind: "completed", at: slot.live_call_completed_at };
  if (slot.delivered_at && !slot.live_call_at) {
    // Forfeit / forfeit-with-materials. live_call_at is sometimes still
    // set; treat any "delivered without completed-call" as delivered.
    return { kind: "delivered", at: slot.delivered_at };
  }
  if (slot.delivered_at) return { kind: "delivered", at: slot.delivered_at };
  if (slot.live_call_at) {
    return new Date(slot.live_call_at).getTime() < nowMs
      ? { kind: "delivered", at: slot.live_call_at }
      : { kind: "upcoming", at: slot.live_call_at };
  }
  return { kind: "unscheduled" };
}

function statusLabel(s: SlotStatus): { label: string; tone: string } {
  switch (s.kind) {
    case "completed":
      return { label: "Completed", tone: "ok" };
    case "delivered":
      return { label: "Delivered", tone: "ok" };
    case "upcoming":
      return { label: "Upcoming", tone: "next" };
    case "no_show":
      return { label: "Missed", tone: "warn" };
    case "unscheduled":
      return { label: "Not scheduled", tone: "muted" };
  }
}

export default async function ProgressPage() {
  const { supabase, player } = await requireParentSession();

  const subResp = await supabase
    .from("subscriptions")
    .select(
      "id, status, lifecycle_state, cycle_lessons_delivered, cycle_skips_used, cycle_started_at, auto_renew_enabled",
    )
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subResp.data as SubLookup | null;

  const curriculaResp = await supabase
    .from("curricula")
    .select(
      "id, status, created_at, approved_at, personalization_note, cycle_anchor_at",
    )
    .eq("player_id", player.id)
    .in("status", ["active", "completed"])
    .order("created_at", { ascending: false });
  const curricula = (curriculaResp.data ?? []) as CurriculumLookup[];

  let slots: SlotLookup[] = [];
  const lessonsById = new Map<string, LessonLookup>();
  if (curricula.length > 0) {
    const ids = curricula.map((c) => c.id);
    const slotsResp = await supabase
      .from("curriculum_slots")
      .select(
        "id, curriculum_id, week_number, is_vod_review, lesson_id, live_call_at, live_call_event_id, live_call_completed_at, no_show_at, delivered_at, coach_note, coach_note_at",
      )
      .in("curriculum_id", ids)
      .order("week_number", { ascending: true });
    slots = (slotsResp.data ?? []) as SlotLookup[];

    const lessonIds = Array.from(
      new Set(slots.map((s) => s.lesson_id).filter((id): id is string => !!id)),
    );
    if (lessonIds.length > 0) {
      const lessonsResp = await supabase
        .from("lessons")
        .select("id, fortnite_label, parent_label, parent_skill_description")
        .in("id", lessonIds);
      for (const l of (lessonsResp.data ?? []) as LessonLookup[]) {
        lessonsById.set(l.id, l);
      }
    }
  }

  const prepResp = await supabase
    .from("prep_responses")
    .select("q2_choice, q2_other_text, q3_reflection")
    .eq("player_id", player.id)
    .maybeSingle();
  const prep = prepResp.data as PrepLookup | null;

  const activeCurriculum = curricula.find((c) => c.status === "active") ?? null;
  const pastCurricula = curricula.filter((c) => c.status === "completed");
  const activeSlots = activeCurriculum
    ? slots.filter((s) => s.curriculum_id === activeCurriculum.id)
    : [];
  const allSlots = slots;
  const nowMs = Date.now();

  // Attendance tally (lifetime, only against live-call-bearing slots).
  let callsCompleted = 0;
  let callsMissed = 0;
  let callsForfeited = 0;
  for (const s of allSlots) {
    if (s.live_call_completed_at) callsCompleted += 1;
    else if (s.no_show_at) callsMissed += 1;
    else if (s.delivered_at && (!s.live_call_at || new Date(s.live_call_at).getTime() < nowMs)) {
      // delivered without a completed call — forfeit (cancelled <24hr or no-show pattern)
      // Only counts the no_show_at===null branch since no_show_at is checked above.
      callsForfeited += 1;
    }
  }
  const totalAccountedCalls = callsCompleted + callsMissed + callsForfeited;

  // Goal blurb pulled from trial prep Q2 if it exists.
  let goalText: string | null = null;
  if (prep?.q2_choice) {
    if (prep.q2_choice === "other" && prep.q2_other_text) {
      goalText = prep.q2_other_text;
    } else {
      goalText = Q2_GOALS[prep.q2_choice] ?? null;
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Program</div>
        <h1 className={styles.title}>Progress</h1>
        <p className={styles.intro}>
          What {player.first_name} has worked through, what's next, and where they started.
        </p>
      </section>

      {sub ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>This cycle</div>
          <h2 className={styles.cardTitle}>
            {sub.lifecycle_state === "ACTIVE"
              ? `Lesson ${Math.min(sub.cycle_lessons_delivered + 1, 4)} of 4`
              : sub.lifecycle_state.toLowerCase().replace(/_/g, " ")}
          </h2>
          <div className={progressStyles.statRow}>
            <Stat label="Delivered" value={`${sub.cycle_lessons_delivered} of 4`} />
            <Stat
              label="Skips used"
              value={`${sub.cycle_skips_used} of 2`}
              tone={sub.cycle_skips_used >= 2 ? "warn" : "default"}
            />
            <Stat
              label="Auto renew"
              value={sub.auto_renew_enabled ? "On" : "Off"}
              tone={sub.auto_renew_enabled ? "ok" : "warn"}
            />
            {sub.cycle_started_at ? (
              <Stat label="Cycle started" value={formatDate(sub.cycle_started_at)} />
            ) : null}
          </div>
        </section>
      ) : null}

      {activeCurriculum && activeSlots.length > 0 ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Current plan</div>
          <h2 className={styles.cardTitle}>4 week curriculum</h2>
          {activeCurriculum.personalization_note ? (
            <p className={progressStyles.personalNote}>
              {activeCurriculum.personalization_note}
            </p>
          ) : null}
          <ul className={progressStyles.weekList}>
            {activeSlots.map((s) => {
              const status = classifySlot(s, nowMs);
              const lesson = s.lesson_id ? lessonsById.get(s.lesson_id) ?? null : null;
              const label = statusLabel(status);
              return (
                <li key={s.id} className={progressStyles.weekRow}>
                  <span className={progressStyles.weekNum}>Week {s.week_number}</span>
                  <span className={progressStyles.weekCopy}>
                    <span className={progressStyles.weekTitle}>
                      {lesson?.parent_label ??
                        (s.is_vod_review ? "VOD review" : "Lesson")}
                    </span>
                    {lesson?.parent_skill_description ? (
                      <span className={progressStyles.weekSkill}>
                        {lesson.parent_skill_description}
                        {lesson.fortnite_label
                          ? ` `
                          : null}
                        {lesson.fortnite_label ? (
                          <em className={progressStyles.fortniteTerm}>
                            (Fortnite term: {lesson.fortnite_label}.)
                          </em>
                        ) : null}
                      </span>
                    ) : null}
                    {status.kind === "upcoming" || status.kind === "completed" ? (
                      <span className={progressStyles.weekWhen}>
                        {formatDateTime(status.at)}
                      </span>
                    ) : null}
                    {s.coach_note ? (
                      <span className={progressStyles.coachNote}>
                        <span className={progressStyles.coachNoteLabel}>Note from Tim</span>
                        {s.coach_note}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`${progressStyles.weekStatus} ${progressStyles[`weekStatus_${label.tone}`] ?? ""}`}
                  >
                    {label.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {totalAccountedCalls > 0 ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Live call attendance</div>
          <h2 className={styles.cardTitle}>
            {callsCompleted} of {totalAccountedCalls} attended
          </h2>
          <div className={progressStyles.statRow}>
            <Stat label="Attended" value={String(callsCompleted)} tone="ok" />
            {callsMissed > 0 ? (
              <Stat label="Missed" value={String(callsMissed)} tone="warn" />
            ) : null}
            {callsForfeited > 0 ? (
              <Stat
                label="Forfeited"
                value={String(callsForfeited)}
                tone="muted"
                hint="cancelled inside 24 hours"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {pastCurricula.length > 0 ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Cycle history</div>
          <h2 className={styles.cardTitle}>
            {pastCurricula.length} completed{" "}
            {pastCurricula.length === 1 ? "cycle" : "cycles"}
          </h2>
          <ul className={progressStyles.cycleList}>
            {pastCurricula.map((c) => {
              const cycleSlots = slots
                .filter((s) => s.curriculum_id === c.id)
                .sort((a, b) => a.week_number - b.week_number);
              return (
                <li key={c.id} className={progressStyles.cycleItem}>
                  <div className={progressStyles.cycleHeader}>
                    <span className={progressStyles.cycleDates}>
                      {c.approved_at ? formatDate(c.approved_at) : formatDate(c.created_at)}
                    </span>
                  </div>
                  <ul className={progressStyles.cycleTopics}>
                    {cycleSlots.map((s) => {
                      const lesson = s.lesson_id
                        ? lessonsById.get(s.lesson_id) ?? null
                        : null;
                      return (
                        <li key={s.id} className={progressStyles.cycleTopic}>
                          <span className={progressStyles.cycleTopicNum}>
                            W{s.week_number}
                          </span>
                          <span className={progressStyles.cycleTopicLabel}>
                            {lesson?.parent_label ??
                              (s.is_vod_review ? "VOD review" : "Lesson")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {goalText ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Where they started</div>
          <h2 className={styles.cardTitle}>{player.first_name}'s opening goal</h2>
          <p className={styles.cardBody}>
            On their free trial intake, {player.first_name} said they wanted to{" "}
            {goalText}.
          </p>
          {prep?.q3_reflection ? (
            <p className={progressStyles.reflection}>
              "{prep.q3_reflection}"
              <span className={progressStyles.reflectionAttr}>
                {" "}
                {player.first_name}'s reflection on their first VOD
              </span>
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Coming soon</div>
        <ul className={styles.bullets}>
          <li>Rank progression over time</li>
          <li>Tim's notes from each lesson</li>
          <li>Milestones {player.first_name} sets along the way</li>
        </ul>
      </section>

      <Link href={"/portal" as never} className={progressStyles.backLink}>
        Back to overview
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn" | "muted";
  hint?: string;
}) {
  return (
    <div
      className={`${progressStyles.stat} ${tone ? progressStyles[`stat_${tone}`] ?? "" : ""}`}
      title={hint}
    >
      <div className={progressStyles.statLabel}>{label}</div>
      <div className={progressStyles.statValue}>{value}</div>
    </div>
  );
}
