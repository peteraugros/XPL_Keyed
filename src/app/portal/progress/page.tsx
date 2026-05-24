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
  trial_call_at: string | null;
};

type QuestRow = { quest_key: string };
type VodRow = { url: string; created_at: string };

// Trial-phase 4-quest list. Mirrors the kid-facing labels on /play but
// stays parent-toned (no "+25 XP" / no game language) since the parent
// just wants to see what's been done.
const TRIAL_QUESTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "signup", label: "Account created" },
  { key: "drop_vod", label: "Uploaded a clip for Tim" },
  { key: "answer_questions", label: "Answered prep questions" },
  { key: "join_discord", label: "Joined Tim's Discord server" },
];

// Onboarding -> ACTIVE pre-payment lifecycle filter.
const ONBOARDING_STATES = new Set([
  "ACCEPTED_PENDING_SCHEDULING",
  "SCHEDULING_IN_PROGRESS",
  "PENDING_PAYMENT",
]);

const TRIAL_PRE_DECISION_STATES = new Set([
  "TRIAL_PREP",
  "TRIAL_SCHEDULED",
  "TRIAL_DONE",
]);

type ProgressPhase = "trial" | "onboarding" | "active" | "history";

function phaseFor(sub: SubLookup | null): ProgressPhase {
  if (!sub) return "trial";
  if (sub.status === "canceled" || sub.status === "declined") return "history";
  if (
    sub.status === "active" ||
    sub.status === "past_due" ||
    sub.status === "pending_cancel"
  ) {
    return "active";
  }
  if (ONBOARDING_STATES.has(sub.lifecycle_state)) return "onboarding";
  if (TRIAL_PRE_DECISION_STATES.has(sub.lifecycle_state)) return "trial";
  return "trial";
}

type PrepFullLookup = {
  q1_choice: string;
  q1_other_text: string | null;
  q2_choice: string;
  q2_other_text: string | null;
  q3_reflection: string;
};

const Q1_FRUSTRATIONS: Record<string, string> = {
  lose_fights: "I lose fights I should win",
  slow_builds: "My building or edits are too slow",
  third_partied: "I keep getting third partied",
  tilt: "I tilt and start playing worse",
  stuck_rank: "I'm stuck at the same rank",
  cant_replicate_streamers: "I can't do what streamers do",
  other: "Something else",
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
  video_url?: string | null;
  parent_skill_description: string;
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

// ---------------------------------------------------------------------------
// Phase-specific status copy. Each takes (sub, firstName) and returns a
// short title + body for the "Where you are" card at the top of the
// phase's content. Keeps the JSX readable.
// ---------------------------------------------------------------------------

function trialStatusTitle(sub: SubLookup | null): string {
  if (!sub) return "Getting set up";
  if (sub.lifecycle_state === "TRIAL_DONE") return "Trial call complete";
  if (sub.lifecycle_state === "TRIAL_SCHEDULED") return "Free intro call booked";
  return "Trial intake submitted";
}

function trialStatusBody(
  sub: SubLookup | null,
  firstName: string,
): string {
  if (!sub) return "If this lingers, refresh in a few seconds.";
  if (sub.lifecycle_state === "TRIAL_DONE") {
    return `Tim is reviewing the session. When he's ready you'll get an email with a 4 week plan for ${firstName} to approve.`;
  }
  if (sub.lifecycle_state === "TRIAL_SCHEDULED" && sub.trial_call_at) {
    return `${formatDateTime(sub.trial_call_at)}. 30 min on Discord. No payment today.`;
  }
  if (sub.lifecycle_state === "TRIAL_SCHEDULED") {
    return "Check your Calendly confirmation for the exact time. 30 min on Discord.";
  }
  return "Trial intake is in. The free intro call confirmation lands in your inbox.";
}

function onboardingStatusTitle(
  sub: SubLookup | null,
  booked: number,
  total: number,
): string {
  if (!sub) return "Onboarding";
  if (sub.lifecycle_state === "PENDING_PAYMENT") return `All ${total} sessions booked`;
  if (sub.lifecycle_state === "SCHEDULING_IN_PROGRESS") {
    return `${booked} of ${total} sessions scheduled`;
  }
  return "Ready to schedule";
}

function onboardingStatusBody(
  sub: SubLookup | null,
  firstName: string,
): string {
  if (!sub) return "";
  if (sub.lifecycle_state === "PENDING_PAYMENT") {
    return `${firstName}'s slots are reserved. Complete payment on the Sessions page to lock them in. The 4 week cycle starts on your first lesson date.`;
  }
  if (sub.lifecycle_state === "SCHEDULING_IN_PROGRESS") {
    return "Finish booking the remaining sessions. Payment unlocks after all 4 are picked.";
  }
  return `Tim accepted ${firstName}. Pick session times when you're ready. They run in the order you book them.`;
}

export default async function ProgressPage() {
  const { supabase, player } = await requireParentSession();

  const subResp = await supabase
    .from("subscriptions")
    .select(
      "id, status, lifecycle_state, cycle_lessons_delivered, cycle_skips_used, cycle_started_at, auto_renew_enabled, trial_call_at",
    )
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subResp.data as SubLookup | null;
  const phase = phaseFor(sub);

  // Curricula widened to include `pending_approval` so the onboarding
  // phase can show the 4-week plan Tim drafted. Active phase still
  // resolves activeCurriculum = first c.status==='active'.
  const curriculaResp = await supabase
    .from("curricula")
    .select(
      "id, status, created_at, approved_at, personalization_note, cycle_anchor_at",
    )
    .eq("player_id", player.id)
    .in("status", ["active", "completed", "pending_approval"])
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
        .select("id, fortnite_label, parent_label, parent_skill_description, video_url")
        .in("id", lessonIds);
      for (const l of (lessonsResp.data ?? []) as LessonLookup[]) {
        lessonsById.set(l.id, l);
      }
    }
  }

  const prepResp = await supabase
    .from("prep_responses")
    .select("q1_choice, q1_other_text, q2_choice, q2_other_text, q3_reflection")
    .eq("player_id", player.id)
    .maybeSingle();
  const prep = prepResp.data as PrepFullLookup | null;

  // Trial-phase extras: which quests have been completed + latest VOD
  // upload. Fetched unconditionally because at our scale the cost is
  // negligible and gating on phase adds branching complexity.
  const [questResp, vodResp] = await Promise.all([
    supabase
      .from("quest_completions")
      .select("quest_key")
      .eq("player_id", player.id),
    supabase
      .from("vod_uploads")
      .select("url, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const completedQuestKeys = new Set(
    ((questResp.data ?? []) as QuestRow[]).map((q) => q.quest_key),
  );
  const latestVod = (vodResp.data as VodRow | null) ?? null;

  // Onboarding-phase curriculum: the drafted-but-not-yet-active plan.
  const pendingCurriculum =
    curricula.find((c) => c.status === "pending_approval") ?? null;
  const pendingSlots = pendingCurriculum
    ? slots.filter((s) => s.curriculum_id === pendingCurriculum.id)
    : [];
  const pendingSlotsBooked = pendingSlots.filter(
    (s) => s.live_call_at !== null,
  ).length;

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

      {/* -----------------------------------------------------------
            TRIAL PHASE: pre-acceptance. Prep checklist mirror + VOD
            link + the kid's own answers to the prep questions. Status
            card at the top reflects TRIAL_PREP / SCHEDULED / DONE.
          ----------------------------------------------------------- */}
      {phase === "trial" ? (
        <>
          <section className={styles.card}>
            <div className={styles.cardEyebrow}>Where you are</div>
            <h2 className={styles.cardTitle}>{trialStatusTitle(sub)}</h2>
            <p className={styles.cardBody}>
              {trialStatusBody(sub, player.first_name)}
            </p>
          </section>

          <section className={styles.card}>
            <div className={styles.cardEyebrow}>Prep progress</div>
            <h2 className={styles.cardTitle}>
              {completedQuestKeys.size} of {TRIAL_QUESTS.length} prep tasks done
            </h2>
            <ul className={progressStyles.questMirror}>
              {TRIAL_QUESTS.map((q) => {
                const done = completedQuestKeys.has(q.key);
                return (
                  <li
                    key={q.key}
                    className={
                      done
                        ? progressStyles.questItemDone
                        : progressStyles.questItemPending
                    }
                  >
                    <span className={progressStyles.questCheck}>
                      {done ? "✓" : "○"}
                    </span>
                    <span>{q.label}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          {latestVod ? (
            <section className={styles.card}>
              <div className={styles.cardEyebrow}>Latest clip</div>
              <h2 className={styles.cardTitle}>
                {player.first_name}&apos;s VOD
              </h2>
              <p className={styles.cardBody}>
                Tim watches this before the call.{" "}
                {latestVod.created_at
                  ? `Uploaded ${formatDate(latestVod.created_at)}.`
                  : null}
              </p>
              <a
                className={progressStyles.vodLink}
                href={latestVod.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {latestVod.url}
              </a>
            </section>
          ) : null}

          {prep && (prep.q1_choice || prep.q2_choice || prep.q3_reflection) ? (
            <section className={styles.card}>
              <div className={styles.cardEyebrow}>
                What {player.first_name} said
              </div>
              <h2 className={styles.cardTitle}>From the prep questions</h2>
              <dl className={progressStyles.prepReadout}>
                {prep.q1_choice ? (
                  <>
                    <dt>What&apos;s most frustrating</dt>
                    <dd>
                      {Q1_FRUSTRATIONS[prep.q1_choice] ?? prep.q1_choice}
                      {prep.q1_other_text ? `. ${prep.q1_other_text}` : ""}
                    </dd>
                  </>
                ) : null}
                {prep.q2_choice ? (
                  <>
                    <dt>What they want</dt>
                    <dd>
                      {Q2_GOALS[prep.q2_choice] ?? prep.q2_choice}
                      {prep.q2_other_text ? `. ${prep.q2_other_text}` : ""}
                    </dd>
                  </>
                ) : null}
                {prep.q3_reflection ? (
                  <>
                    <dt>Their VOD reflection</dt>
                    <dd>&ldquo;{prep.q3_reflection}&rdquo;</dd>
                  </>
                ) : null}
              </dl>
            </section>
          ) : null}
        </>
      ) : null}

      {/* -----------------------------------------------------------
            ONBOARDING PHASE: post-acceptance, pre-payment. Status
            card + the 4-week plan with slot booking + payment state.
          ----------------------------------------------------------- */}
      {phase === "onboarding" ? (
        <>
          <section className={styles.card}>
            <div className={styles.cardEyebrow}>Where you are</div>
            <h2 className={styles.cardTitle}>
              {onboardingStatusTitle(
                sub,
                pendingSlotsBooked,
                pendingSlots.length || 4,
              )}
            </h2>
            <p className={styles.cardBody}>
              {onboardingStatusBody(sub, player.first_name)}
            </p>
          </section>

          {pendingCurriculum && pendingSlots.length > 0 ? (
            <section className={styles.card}>
              <div className={styles.cardEyebrow}>The 4 week plan</div>
              <h2 className={styles.cardTitle}>Approved curriculum</h2>
              {pendingCurriculum.personalization_note ? (
                <p className={progressStyles.personalNote}>
                  {pendingCurriculum.personalization_note}
                </p>
              ) : null}
              <ul className={progressStyles.weekList}>
                {pendingSlots.map((s) => {
                  const lesson = s.lesson_id
                    ? lessonsById.get(s.lesson_id) ?? null
                    : null;
                  return (
                    <li key={s.id} className={progressStyles.weekRow}>
                      <span className={progressStyles.weekNum}>
                        Week {s.week_number}
                      </span>
                      <span className={progressStyles.weekCopy}>
                        <span className={progressStyles.weekTitle}>
                          {lesson?.parent_label ??
                            (s.is_vod_review ? "VOD review" : "Lesson")}
                        </span>
                        {lesson?.parent_skill_description ? (
                          <span className={progressStyles.weekSkill}>
                            {lesson.parent_skill_description}
                            {lesson.fortnite_label ? " " : null}
                            {lesson.fortnite_label ? (
                              <em className={progressStyles.fortniteTerm}>
                                (Fortnite term: {lesson.fortnite_label}.)
                              </em>
                            ) : null}
                          </span>
                        ) : null}
                        {s.live_call_at ? (
                          <span className={progressStyles.weekWhen}>
                            {formatDateTime(s.live_call_at)}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`${progressStyles.weekStatus} ${
                          s.live_call_at
                            ? progressStyles.weekStatus_next
                            : progressStyles.weekStatus_muted
                        }`}
                      >
                        {s.live_call_at ? "Booked" : "Not booked"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {/* -----------------------------------------------------------
            HISTORY PHASE: canceled or declined. Brief reassurance
            that data is preserved. Past cycle history + attendance
            still render below if the family had any activity.
          ----------------------------------------------------------- */}
      {phase === "history" ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Account status</div>
          <h2 className={styles.cardTitle}>
            {sub?.status === "declined" ? "Trial wrapped" : "Coaching ended"}
          </h2>
          <p className={styles.cardBody}>
            {sub?.status === "declined"
              ? `Tim suggested other paths after the free call. ${player.first_name}'s account stays open if anything changes.`
              : `${player.first_name}'s coaching has ended. Your history, messages, and progress are preserved here. Restart any time.`}
          </p>
        </section>
      ) : null}

      {/* -----------------------------------------------------------
            ACTIVE PHASE: paying customer, cycle running. Existing
            cards. Past cycle history + attendance also surface for
            the history phase so wrapped-up families can look back.
          ----------------------------------------------------------- */}
      {phase === "active" && sub ? (
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

      {phase === "active" && activeCurriculum && activeSlots.length > 0 ? (
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
                    {lesson?.video_url && (status.kind === "delivered" || status.kind === "completed") ? (
                      <a
                        href={lesson.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={progressStyles.watchLink}
                      >
                        Watch the lesson video →
                      </a>
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

      {(phase === "active" || phase === "history") && totalAccountedCalls > 0 ? (
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

      {(phase === "active" || phase === "history") && pastCurricula.length > 0 ? (
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
