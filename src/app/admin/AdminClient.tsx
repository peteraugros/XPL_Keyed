"use client";

// Tim's coach dashboard surface. Coach-tone palette: same dark bg + lime
// accents as the parent /portal, but no rarity colors or XP gamification.
// Functional badges only.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import MessageThread, { type MessageRow } from "@/components/MessageThread";
import { playChime } from "@/lib/sound/chime";
import { getSoundEnabled } from "@/lib/sound/prefs";

const Q1_LABELS: Record<string, string> = {
  lose_fights: "Loses fights they should win",
  build_slow: "Building or edits are too slow",
  third_partied: "Gets third partied",
  tilt: "Tilts and plays worse",
  stuck_rank: "Stuck at the same rank",
  streamer_gap: "Can't replicate what streamers do",
  other: "Something else",
};
const Q2_LABELS: Record<string, string> = {
  stop_dying: "Stop dying so fast",
  beat_friends: "Beat their friends consistently",
  hit_unreal: "Hit Unreal",
  top_10k_cashcup: "Top 10K in a Cash Cup",
  fncs: "FNCS",
  prize_money: "Win prize money",
  other: "Something else",
};

const QUEST_LABELS: Record<string, string> = {
  signup: "Signup",
  drop_vod: "VOD",
  answer_questions: "Prep Qs",
  join_discord: "Discord",
};
const QUEST_ORDER = ["signup", "drop_vod", "answer_questions", "join_discord"] as const;

export type Player = {
  id: string;
  family_id: string;
  first_name: string;
  age: number;
  fortnite_username: string | null;
  discord_username: string | null;
  current_rank: string | null;
  platform: string | null;
  hours_per_week: number | null;
  discord_channel_url: string | null;
};
export type Parent = { family_id: string; first_name: string; email: string };
export type Prep = {
  q1_choice: string;
  q1_other_text: string | null;
  q2_choice: string;
  q2_other_text: string | null;
  q3_reflection: string;
};

export type TrialCard = {
  subscription_id: string;
  player_id: string;
  player: Player | null;
  parent: Parent | null;
  completed_quest_keys: string[];
  latest_vod_url: string | null;
  prep: Prep | null;
  messages: MessageRow[];
  created_at: string;
};

export type ActiveRow = {
  subscription_id: string;
  player_id: string;
  player_first_name: string;
  parent_first_name: string;
  // Real subscription.status. Includes 'active' (paying, delivering),
  // 'past_due' (paying, frozen on a card failure), and 'pending_cancel'
  // (winding down inside the 7 day undo window). canceled / declined
  // are filtered upstream — they don't appear in this list.
  status: string;
  cycle_lessons_delivered: number;
  cycle_cancels_used: number;
  messages: MessageRow[];
};

type DerivedTask = {
  task_type: string;
  client_id: string;
  client_name: string;
  age_in_state: string;
  source_object_id: string;
  priority_score: number;
  task_payload: Record<string, unknown> | null;
};

type PipelineCard = {
  subscription_id: string;
  player_id: string;
  player_first_name: string;
  parent_first_name: string;
  lifecycle_state: string;
  waiting_on: string;
  cycle_lessons_delivered: number;
  cycle_cancels_used: number;
  prep_completed: number;
};

type WaitlistEntry = {
  id: string;
  parent_email: string;
  kid_first_name: string;
  kid_age: number | null;
  created_at: string;
  status: string;
};

type ReturnedStuck = {
  id: string;
  object_type: string;
  resolution_note: string;
  resolved_at: string;
};

// Per-welcome-task context shipped down from the server so the welcome
// card can render the 4 booked dates + show the .ics download link
// without an extra client round-trip.
type WelcomeContext = {
  subscription_id: string;
  player_id: string;
  slots: Array<{
    week_number: number;
    live_call_at: string | null;
    live_call_event_id: string | null;
  }>;
  has_auto_booked: boolean;
};

// Per-trial-booked-task context (awareness card showing a freshly
// booked free intro call before the call happens).
type TrialBookedContext = {
  subscription_id: string;
  player_id: string;
  kid_age: number;
  parent_first_name: string;
  parent_email: string;
  prep_completed: number;
  total_quests: number;
  trial_call_at: string | null;
};

export default function AdminClient({
  coachMode,
  stats,
  tasks,
  pipelineCards,
  waitlistEntries,
  returnedStucks,
  doneToday,
  welcomeContexts,
  trialBookedContexts,
}: {
  coachMode: "focused" | "command";
  stats: {
    payingCount: number;
    capacity: number;
    trialsThisWeek: number;
    waitlistCount: number;
    waitlistOldestDays: number | null;
  };
  tasks: DerivedTask[];
  pipelineCards: PipelineCard[];
  waitlistEntries: WaitlistEntry[];
  returnedStucks: ReturnedStuck[];
  doneToday: number;
  welcomeContexts: WelcomeContext[];
  trialBookedContexts: TrialBookedContext[];
}) {
  const router = useRouter();

  return (
    <div className={styles.homeFrame}>
      <StuckReturnBanner returnedStucks={returnedStucks} />

      {coachMode === "command" ? (
        <CommandPipeline pipelineCards={pipelineCards} waitlistEntries={waitlistEntries} stats={stats} />
      ) : (
        <FocusedHome
          tasks={tasks}
          doneToday={doneToday}
          welcomeContexts={welcomeContexts}
          trialBookedContexts={trialBookedContexts}
        />
      )}

      <section className={styles.statsStrip}>
        <Stat
          label="Paying"
          value={`${stats.payingCount} / ${stats.capacity}`}
          tone={stats.payingCount >= stats.capacity ? "warn" : "ok"}
        />
        <Stat label="Trials this week" value={String(stats.trialsThisWeek)} />
        <Stat
          label="Waitlist"
          value={
            stats.waitlistCount === 0
              ? "0"
              : stats.waitlistOldestDays !== null
                ? `${stats.waitlistCount} (oldest ${stats.waitlistOldestDays}d)`
                : String(stats.waitlistCount)
          }
        />
        <Stat label="Revenue MTD" value="$0" tone="muted" hint="Wires up once Stripe webhooks land real charges." />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stuck-return banner — Dad sent a note back
// ---------------------------------------------------------------------------
// When Dad picks "Send back with note" on a Stuck, the note lives on
// stuck_events.resolution_note. This banner surfaces unseen notes on
// Tim's /admin and lets him dismiss them per-note. Per dad-admin-spec.md
// section 3: "No silent reassignments. Tim should always know when a
// task came back from Dad and why."
function StuckReturnBanner({ returnedStucks }: { returnedStucks: ReturnedStuck[] }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (returnedStucks.length === 0) return null;
  const visible = returnedStucks.filter((s) => !dismissed.has(s.id));
  if (visible.length === 0) return null;

  async function ack(ids: string[]) {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    try {
      await fetch("/api/admin/stuck-ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stuck_ids: ids }),
      });
      router.refresh();
    } catch {
      // Optimistic dismissal already applied; server-side ack failure is
      // observability only. The banner will resurface on next page load.
    }
  }

  return (
    <section className={styles.returnBanner}>
      <div className={styles.returnBannerHeader}>
        <span className={styles.returnBannerEyebrow}>From Dad</span>
        {visible.length > 1 ? (
          <button
            type="button"
            className={styles.returnBannerAckAll}
            onClick={() => ack(visible.map((s) => s.id))}
          >
            Got it on all {visible.length}
          </button>
        ) : null}
      </div>
      <ul className={styles.returnBannerList}>
        {visible.map((s) => (
          <li key={s.id} className={styles.returnBannerItem}>
            <div className={styles.returnBannerNote}>{s.resolution_note}</div>
            <div className={styles.returnBannerRow}>
              <span className={styles.returnBannerType}>
                {s.object_type.replace(/_/g, " ")}
              </span>
              <button
                type="button"
                className={styles.returnBannerAck}
                onClick={() => ack([s.id])}
              >
                Got it
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mode toggle — [Focused] [Command] in the header
// ---------------------------------------------------------------------------
// Per Coach Dashboard Spec/CEO/admin-modes.md. Per-user persisted via
// POST /api/admin/mode. Click switches the route's rendering and
// re-fetches via router.refresh.
function ModeToggle({
  current,
  router,
}: {
  current: "focused" | "command";
  router: ReturnType<typeof useRouter>;
}) {
  const [busy, setBusy] = useState(false);

  async function switchTo(mode: "focused" | "command") {
    if (mode === current || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modeToggle} role="radiogroup" aria-label="Admin mode">
      <button
        type="button"
        role="radio"
        aria-checked={current === "focused"}
        className={`${styles.modeBtn} ${current === "focused" ? styles.modeBtnActive : ""}`}
        onClick={() => switchTo("focused")}
        disabled={busy}
      >
        Focused
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={current === "command"}
        className={`${styles.modeBtn} ${current === "command" ? styles.modeBtnActive : ""}`}
        onClick={() => switchTo("command")}
        disabled={busy}
      >
        Command
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Command-mode Pipeline — kanban-style horizontal columns
// ---------------------------------------------------------------------------
// Per Coach Dashboard Spec/CEO/admin-spec-command.md. The Command-mode
// Home is the full pipeline at a glance: one column per lifecycle stage,
// stacked client cards per column. Dense, scannable, no narrative wrap.
//
// For phase 1 we render six columns mapped from lifecycle_state:
// Trial Prep / Trial Done / Active / Past Due / Pending Cancel /
// Waitlist (last column reads from waitlist_entries, not subscriptions).
// CANCELED rows are not shown (terminal).
const PIPELINE_COLUMNS: { state: string; label: string }[] = [
  { state: "TRIAL_PREP", label: "Trial prep" },
  { state: "TRIAL_SCHEDULED", label: "Trial scheduled" },
  { state: "TRIAL_DONE", label: "Trial done" },
  { state: "ACCEPTED_PENDING_SCHEDULING", label: "Accepted" },
  { state: "SCHEDULING_IN_PROGRESS", label: "Booking" },
  { state: "PENDING_PAYMENT", label: "Paying" },
  { state: "ACTIVE", label: "Active" },
  { state: "PAST_DUE", label: "Past due" },
  { state: "PENDING_CANCEL", label: "Pending cancel" },
];

function CommandPipeline({
  pipelineCards,
  waitlistEntries,
  stats,
}: {
  pipelineCards: PipelineCard[];
  waitlistEntries: WaitlistEntry[];
  stats: {
    payingCount: number;
    capacity: number;
    trialsThisWeek: number;
    waitlistCount: number;
    waitlistOldestDays: number | null;
  };
}) {
  // Group cards by lifecycle_state.
  const byState = new Map<string, PipelineCard[]>();
  for (const c of pipelineCards) {
    if (c.lifecycle_state === "CANCELED") continue;
    const arr = byState.get(c.lifecycle_state) ?? [];
    arr.push(c);
    byState.set(c.lifecycle_state, arr);
  }

  return (
    <section className={styles.commandPipeline}>
      <div className={styles.commandPipelineHeader}>
        <div className={styles.commandPipelineTitle}>Pipeline</div>
        <div className={styles.commandPipelineStats}>
          <span>{stats.payingCount}/{stats.capacity} paying</span>
          <span className={styles.focusedHomeDot}>·</span>
          <span>{stats.trialsThisWeek} trials this week</span>
          <span className={styles.focusedHomeDot}>·</span>
          <span>
            {stats.waitlistCount} on waitlist
            {stats.waitlistOldestDays !== null ? ` (${stats.waitlistOldestDays}d oldest)` : ""}
          </span>
        </div>
      </div>

      <div className={styles.commandPipelineColumns}>
        {PIPELINE_COLUMNS.map((col) => {
          const cards = byState.get(col.state) ?? [];
          return (
            <div key={col.state} className={styles.pipelineColumn}>
              <div className={styles.pipelineColumnHeader}>
                <span className={styles.pipelineColumnLabel}>{col.label}</span>
                <span className={styles.pipelineColumnCount}>{cards.length}</span>
              </div>
              <div className={styles.pipelineColumnList}>
                {cards.length === 0 ? (
                  <div className={styles.pipelineColumnEmpty}>—</div>
                ) : (
                  cards.map((c) => (
                    <a
                      key={c.subscription_id}
                      href={`/admin/clients?client=${c.player_id}`}
                      className={`${styles.pipelineCard} ${c.waiting_on === "TIM" ? styles.pipelineCardWaitingTim : ""}`}
                    >
                      <div className={styles.pipelineCardName}>{c.player_first_name}</div>
                      <div className={styles.pipelineCardMeta}>
                        {c.lifecycle_state === "TRIAL_PREP" || c.lifecycle_state === "TRIAL_SCHEDULED" ? (
                          <span>prep {c.prep_completed}/4</span>
                        ) : c.lifecycle_state === "ACTIVE" ? (
                          <span>cyc {c.cycle_lessons_delivered}/4 · skips {c.cycle_cancels_used}/2</span>
                        ) : c.lifecycle_state === "PAST_DUE" ? (
                          <span>past due</span>
                        ) : c.lifecycle_state === "PENDING_CANCEL" ? (
                          <span>cancel pending</span>
                        ) : (
                          <span>{c.lifecycle_state.toLowerCase()}</span>
                        )}
                        {c.waiting_on === "TIM" ? <span className={styles.pipelineCardWaitingDot}>· you</span> : null}
                      </div>
                    </a>
                  ))
                )}
              </div>
            </div>
          );
        })}

        {/* Waitlist column — separate data source */}
        <div className={styles.pipelineColumn}>
          <div className={styles.pipelineColumnHeader}>
            <span className={styles.pipelineColumnLabel}>Waitlist</span>
            <span className={styles.pipelineColumnCount}>{waitlistEntries.length}</span>
          </div>
          <div className={styles.pipelineColumnList}>
            {waitlistEntries.length === 0 ? (
              <div className={styles.pipelineColumnEmpty}>—</div>
            ) : (
              waitlistEntries.map((w) => {
                const ageDays = Math.floor(
                  (Date.now() - new Date(w.created_at).getTime()) / (1000 * 3600 * 24),
                );
                return (
                  <div key={w.id} className={styles.pipelineCard}>
                    <div className={styles.pipelineCardName}>{w.kid_first_name}</div>
                    <div className={styles.pipelineCardMeta}>
                      {ageDays}d on list{w.kid_age !== null ? ` · age ${w.kid_age}` : ""}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Focused-mode Home — single top task surface + expansion
// ---------------------------------------------------------------------------
// Per Coach Dashboard Spec/CEO/admin-spec-focused.md section 4 ("One Thing").
// Top task is hero-styled with task-type-aware copy + inline action (inline
// reply for messages, scroll-anchor for trials/cancels). Below, "X more
// waiting" is click-to-expand: reveals tasks 2..N as compact rows with
// per-task CTAs. Empty state when no tasks are waiting on Tim.
function FocusedHome({
  tasks,
  doneToday,
  welcomeContexts,
  trialBookedContexts,
}: {
  tasks: DerivedTask[];
  doneToday: number;
  welcomeContexts: WelcomeContext[];
  trialBookedContexts: TrialBookedContext[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  // Inline reply state for the top task when it's a message_thread.
  const [replyBody, setReplyBody] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySent, setReplySent] = useState(false);

  // Task-completion chime: fires when the task list shrinks after a
  // router.refresh(). First mount doesn't fire (prev=undefined). We
  // gate on getSoundEnabled() so the localStorage mute toggle wins.
  // Read fresh each effect so toggling the mute doesn't need a remount.
  const prevTaskCountRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevTaskCountRef.current;
    prevTaskCountRef.current = tasks.length;
    if (prev === null) return; // first render, no prior to compare
    if (tasks.length < prev && getSoundEnabled()) {
      playChime();
    }
  }, [tasks.length]);

  if (tasks.length === 0) {
    return (
      <section className={styles.focusedHomeEmpty}>
        <div className={styles.focusedHomeEyebrow}>Home</div>
        <div className={styles.focusedHomeEmptyTitle}>Nothing waiting on you.</div>
        <div className={styles.focusedHomeEmptyBody}>
          Quiet inbox. Tim&apos;s on top of it. Stay loose.
        </div>
        {doneToday > 0 ? (
          <div className={styles.focusedHomeStreak}>
            ✦ {doneToday} done today
          </div>
        ) : null}
      </section>
    );
  }

  const topTask = tasks[0];
  const remaining = tasks.slice(1);
  const phrasing = phraseForTask(topTask);
  const ageStr = formatAge(topTask.age_in_state);
  const isMessageThread = topTask.task_type === "message_thread";
  const isWelcome = topTask.task_type === "new_student_welcome";
  const welcomeCtx = isWelcome
    ? welcomeContexts.find(
        (c) =>
          c.subscription_id ===
          (topTask.task_payload?.subscription_id as string | undefined),
      ) ?? null
    : null;
  const isTrialBooked = topTask.task_type === "new_trial_booked";
  const trialBookedCtx = isTrialBooked
    ? trialBookedContexts.find(
        (c) =>
          c.subscription_id ===
          (topTask.task_payload?.subscription_id as string | undefined),
      ) ?? null
    : null;
  const isParentScheduling = topTask.task_type === "parent_started_scheduling";
  const isPendingPayment = topTask.task_type === "pending_payment";
  const isPastDue = topTask.task_type === "past_due_opened";
  const isVodDropped = topTask.task_type === "vod_dropped";
  const isPrepAnswered = topTask.task_type === "prep_answered";
  const isAutoRenewOff = topTask.task_type === "subscription_auto_renew_off";
  const isLessonStub = topTask.task_type === "lesson_authoring_needed";
  const isTikTok = topTask.task_type === "tiktok_daily_reminder";
  const isAwareness =
    isTrialBooked || isParentScheduling || isPendingPayment || isVodDropped || isPrepAnswered || isAutoRenewOff || isTikTok;

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    setReplyError(null);
    const trimmed = replyBody.trim();
    if (!trimmed) return;
    setReplySubmitting(true);
    try {
      const res = await fetch("/api/admin/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player_id: topTask.client_id, body: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setReplyError(body.error ?? "Could not send. Try again.");
        setReplySubmitting(false);
        return;
      }
      setReplyBody("");
      setReplySent(true);
      router.refresh();
    } catch {
      setReplyError("Could not reach the server.");
    }
    setReplySubmitting(false);
  }

  return (
    <section
      className={`${styles.focusedHome} ${
        isWelcome
          ? styles.focusedHomeWelcome
          : isPastDue
            ? styles.focusedHomePastDue
            : isAwareness
              ? styles.focusedHomeTrialBooked
              : ""
      }`}
    >
      <div className={styles.focusedHomeEyebrow}>
        {isWelcome ? (
          <span className={styles.newStudentPill}>NEW STUDENT</span>
        ) : isTrialBooked ? (
          <span className={styles.newTrialPill}>FREE CALL BOOKED</span>
        ) : isParentScheduling ? (
          <span className={styles.newTrialPill}>SCHEDULING</span>
        ) : isPendingPayment ? (
          <span className={styles.newTrialPill}>AWAITING PAYMENT</span>
        ) : isPastDue ? (
          <span className={styles.pastDuePill}>CARD DECLINED</span>
        ) : isVodDropped ? (
          <span className={styles.newTrialPill}>NEW VOD</span>
        ) : isPrepAnswered ? (
          <span className={styles.newTrialPill}>PREP IN</span>
        ) : isAutoRenewOff ? (
          <span className={styles.pastDuePill}>AUTO RENEW OFF</span>
        ) : isLessonStub ? (
          <span className={styles.pastDuePill}>LESSON STUB</span>
        ) : isTikTok ? (
          <span className={styles.newTrialPill}>FUNNEL</span>
        ) : (
          "Next thing"
        )}
      </div>
      <h2 className={`${styles.focusedHomeTitle} ${isWelcome || isAwareness || isPastDue ? styles.focusedHomeTitleLarge : ""}`}>
        {phrasing.title}
      </h2>
      {phrasing.body ? (
        <p className={styles.focusedHomeBody}>{phrasing.body}</p>
      ) : null}
      <div className={styles.focusedHomeMeta}>
        {isTikTok ? null : (
          <>
            <span className={styles.focusedHomeKid}>{topTask.client_name}</span>
            <span className={styles.focusedHomeDot}>·</span>
          </>
        )}
        <span className={styles.focusedHomeAge}>{ageStr}</span>
        {isTikTok ? null : (
          <>
            <span className={styles.focusedHomeDot}>·</span>
            <StuckButton task={topTask} variant="link" />
          </>
        )}
      </div>

      {isWelcome ? (
        <WelcomeForm
          subscriptionId={(topTask.task_payload?.subscription_id as string) ?? ""}
          playerId={topTask.client_id}
          kidFirstName={topTask.client_name}
          ctx={welcomeCtx}
        />
      ) : isTrialBooked ? (
        <TrialBookedCard
          playerId={topTask.client_id}
          kidFirstName={topTask.client_name}
          ctx={trialBookedCtx}
        />
      ) : isMessageThread && !replySent ? (
        <form className={styles.inlineReply} onSubmit={submitReply}>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder={`Reply to ${topTask.client_name}...`}
            rows={2}
            maxLength={2000}
            className={styles.inlineReplyInput}
          />
          <div className={styles.inlineReplyRow}>
            <button
              type="submit"
              className={styles.focusedHomeCta}
              disabled={replySubmitting || !replyBody.trim()}
            >
              {replySubmitting ? "Sending..." : "Send reply"}
            </button>
            <a
              href={`/admin/clients?client=${topTask.client_id}`}
              className={styles.inlineReplySecondary}
            >
              Open thread
            </a>
            {replyError ? <span className={styles.inlineReplyError}>{replyError}</span> : null}
          </div>
        </form>
      ) : isMessageThread && replySent ? (
        <div className={styles.inlineReplySent}>
          Replied to {topTask.client_name}. Refreshing the queue...
        </div>
      ) : isVodDropped ? (
        <div className={styles.inlineReplyRow}>
          <a
            href={`/admin/clients?client=${topTask.client_id}`}
            className={styles.focusedHomeCta}
          >
            Open card
          </a>
          {(() => {
            const url = (topTask.task_payload?.vod_url as string | undefined) ?? null;
            return url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.inlineReplySecondary}
              >
                Watch clip
              </a>
            ) : null;
          })()}
        </div>
      ) : isAutoRenewOff ? (
        <AutoRenewOffActions
          subscriptionId={(topTask.task_payload?.subscription_id as string) ?? ""}
          onDone={() => router.refresh()}
        />
      ) : isLessonStub ? (
        <div className={styles.inlineReplyRow}>
          <a href={"/admin/lessons" as never} className={styles.focusedHomeCta}>
            Open lesson library
          </a>
          <a
            href={`/admin/clients?client=${topTask.client_id}`}
            className={styles.inlineReplySecondary}
          >
            Open client card
          </a>
        </div>
      ) : isTikTok ? (
        <TikTokLogButton onDone={() => router.refresh()} />
      ) : (
        <a href={`/admin/clients?client=${topTask.client_id}`} className={styles.focusedHomeCta}>
          {phrasing.cta}
        </a>
      )}

      {remaining.length > 0 ? (
        <div className={styles.focusedHomeExpander}>
          <button
            type="button"
            className={styles.focusedHomeMoreToggle}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide" : `${remaining.length} more waiting`}
          </button>
          {expanded ? (
            <ul className={styles.focusedHomeMoreList}>
              {remaining.map((t) => {
                const p = phraseForTask(t);
                return (
                  <li key={`${t.task_type}-${t.source_object_id}`} className={styles.focusedHomeMoreItem}>
                    <div className={styles.focusedHomeMoreCopy}>
                      <span className={styles.focusedHomeMoreName}>{t.client_name}</span>
                      <span className={styles.focusedHomeMoreSubtitle}>{p.title}</span>
                      <span className={styles.focusedHomeMoreAge}>
                        {formatAge(t.age_in_state)} · <StuckButton task={t} variant="link" />
                      </span>
                    </div>
                    <a href={`/admin/clients?client=${t.client_id}`} className={styles.focusedHomeMoreCta}>
                      {p.cta}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {doneToday > 0 ? (
        <div className={styles.focusedHomeStreak}>
          ✦ {doneToday} done today
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Welcome form — rendered inline inside FocusedHome when the top task
// is new_student_welcome. Lists the 4 booked dates, offers an .ics
// download for the auto-book path, takes an optional welcome message
// + discord channel URL, and confirms via "I welcomed them" → POSTs to
// /api/admin/welcome which flips waiting_on=SYSTEM and drops the task.
// ---------------------------------------------------------------------------

function WelcomeForm({
  subscriptionId,
  playerId,
  kidFirstName,
  ctx,
}: {
  subscriptionId: string;
  playerId: string;
  kidFirstName: string;
  ctx: WelcomeContext | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [discordUrl, setDiscordUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = ctx?.slots ?? [];
  const hasAutoBooked = !!ctx?.has_auto_booked;
  const icsUrl = `/api/admin/clients/${playerId}/sessions.ics`;

  async function onConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/welcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscription_id: subscriptionId,
          welcome_message: message.trim() || undefined,
          discord_channel_url: discordUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Welcome failed. Try again.");
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.welcomeForm}>
      {slots.length > 0 ? (
        <div className={styles.welcomeSection}>
          <div className={styles.welcomeSectionLabel}>Booked sessions</div>
          <ul className={styles.welcomeSlotList}>
            {slots.map((s) => (
              <li key={s.week_number} className={styles.welcomeSlotItem}>
                <span className={styles.welcomeSlotWeek}>Week {s.week_number}</span>
                <span className={styles.welcomeSlotTime}>
                  {s.live_call_at
                    ? new Intl.DateTimeFormat("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(s.live_call_at))
                    : "(no time yet)"}
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.welcomeCalendarLine}>
            {hasAutoBooked ? (
              <>
                <span>These are not on your Google Calendar yet.</span>
                <a
                  href={icsUrl}
                  className={styles.welcomeIcsBtn}
                  download
                >
                  Add to Google Calendar (.ics)
                </a>
              </>
            ) : (
              <span>These are already on your Google Calendar via Calendly.</span>
            )}
          </div>
        </div>
      ) : null}

      <div className={styles.welcomeSection}>
        <label className={styles.welcomeSectionLabel} htmlFor={`welcome-msg-${subscriptionId}`}>
          Welcome message to {kidFirstName} (optional)
        </label>
        <textarea
          id={`welcome-msg-${subscriptionId}`}
          className={styles.welcomeTextarea}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={`Hey ${kidFirstName}! Pumped to coach you...`}
        />
      </div>

      <div className={styles.welcomeSection}>
        <label className={styles.welcomeSectionLabel} htmlFor={`welcome-discord-${subscriptionId}`}>
          Discord channel invite (optional)
        </label>
        <input
          id={`welcome-discord-${subscriptionId}`}
          className={styles.welcomeInput}
          type="text"
          value={discordUrl}
          onChange={(e) => setDiscordUrl(e.target.value)}
          maxLength={500}
          placeholder="https://discord.gg/..."
        />
      </div>

      {error ? <div className={styles.welcomeError}>{error}</div> : null}

      <div className={styles.welcomeActions}>
        <button
          type="button"
          className={styles.focusedHomeCta}
          onClick={onConfirm}
          disabled={submitting}
        >
          {submitting ? "Saving..." : "I welcomed them"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrialBookedCard — awareness card for a freshly booked free call.
// Surfaces while the call is still upcoming. Auto-drops once the call
// time + 30min has passed and the trial_decision task takes over.
// Tim doesn't need to act on this card — Calendly synced his calendar.
// It just keeps him aware that something's happening.
// ---------------------------------------------------------------------------

function TrialBookedCard({
  playerId,
  kidFirstName,
  ctx,
}: {
  playerId: string;
  kidFirstName: string;
  ctx: TrialBookedContext | null;
}) {
  if (!ctx) {
    // No context yet — degrade gracefully with just the CTA.
    return (
      <div className={styles.welcomeActions}>
        <a
          href={`/admin/clients?client=${playerId}`}
          className={styles.focusedHomeCta}
        >
          Open card
        </a>
      </div>
    );
  }

  const callTime = ctx.trial_call_at
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(ctx.trial_call_at))
    : "(time pending)";

  return (
    <div className={styles.welcomeForm}>
      <div className={styles.welcomeSection}>
        <div className={styles.welcomeSectionLabel}>Call time</div>
        <div className={styles.welcomeSlotItem}>
          <span className={styles.welcomeSlotTime}>{callTime}</span>
        </div>
        <div className={styles.welcomeCalendarLine}>
          <span>Already on your Google Calendar via Calendly.</span>
        </div>
      </div>

      <div className={styles.welcomeSection}>
        <div className={styles.welcomeSectionLabel}>Who</div>
        <div className={styles.welcomeSlotItem}>
          <span className={styles.welcomeSlotTime}>
            {kidFirstName}, age {ctx.kid_age} · parent {ctx.parent_first_name}
            {ctx.parent_email ? ` (${ctx.parent_email})` : ""}
          </span>
        </div>
      </div>

      <div className={styles.welcomeSection}>
        <div className={styles.welcomeSectionLabel}>Prep</div>
        <div className={styles.welcomeSlotItem}>
          <span className={styles.welcomeSlotTime}>
            {ctx.prep_completed} of {ctx.total_quests} prep tasks done
            {ctx.prep_completed === ctx.total_quests
              ? ". Ready to roll."
              : ` (the more, the better the first call goes).`}
          </span>
        </div>
      </div>

      <div className={styles.welcomeActions}>
        <a
          href={`/admin/clients?client=${playerId}`}
          className={styles.focusedHomeCta}
        >
          Open client card
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stuck button — Tim's escalation affordance
// ---------------------------------------------------------------------------
// Per Coach Dashboard Spec/backend-spec.md section 3 + 7. Click writes a
// stuck_events row, flips the source object's waiting_on to DAD, fires a
// Discord DM. Two-step UX: first click reveals a tiny reason prompt
// (optional), second click submits. Cancel resets.
function StuckButton({
  task,
  variant = "link",
}: {
  task: DerivedTask;
  variant?: "link" | "button";
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "prompting" | "submitting" | "sent">("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Map task_type -> stuck_events.object_type
  function mapType(t: string): string {
    if (t === "message_thread") return "message_thread";
    if (t === "trial_decision") return "trial_decision";
    if (t === "cancellation_event") return "cancellation_event";
    return "other";
  }

  async function submit() {
    setError(null);
    setStage("submitting");
    try {
      const res = await fetch("/api/admin/stuck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          object_type: mapType(task.task_type),
          object_id: task.source_object_id,
          client_name: task.client_name,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed.");
        setStage("prompting");
        return;
      }
      setStage("sent");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setStage("prompting");
    }
  }

  if (stage === "sent") {
    return <span className={styles.stuckSent}>Sent to Dad</span>;
  }

  if (stage === "idle") {
    return (
      <button
        type="button"
        className={variant === "link" ? styles.stuckLink : styles.stuckBtn}
        onClick={() => setStage("prompting")}
      >
        Stuck
      </button>
    );
  }

  // Prompting / submitting
  return (
    <span className={styles.stuckPrompt}>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why? (optional)"
        maxLength={500}
        className={styles.stuckInput}
        autoFocus
      />
      <button
        type="button"
        className={styles.stuckSubmit}
        onClick={submit}
        disabled={stage === "submitting"}
      >
        {stage === "submitting" ? "Sending..." : "Send to Dad"}
      </button>
      <button
        type="button"
        className={styles.stuckCancel}
        onClick={() => {
          setStage("idle");
          setReason("");
          setError(null);
        }}
        disabled={stage === "submitting"}
      >
        Cancel
      </button>
      {error ? <span className={styles.stuckError}>{error}</span> : null}
    </span>
  );
}

function TikTokLogButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function log() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/tiktok/log", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not log.");
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <div className={styles.inlineReplyRow}>
      <button
        type="button"
        onClick={log}
        disabled={busy}
        className={styles.focusedHomeCta}
      >
        {busy ? "Logging..." : "✓ Commented today"}
      </button>
      {error ? <span className={styles.inlineReplyError}>{error}</span> : null}
    </div>
  );
}

function AutoRenewOffActions({
  subscriptionId,
  onDone,
}: {
  subscriptionId: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState<null | "ack" | "reenable">(null);
  const [error, setError] = useState<string | null>(null);

  async function ack() {
    setError(null);
    setSubmitting("ack");
    try {
      const res = await fetch(
        `/api/admin/subscriptions/${subscriptionId}/ack-auto-renew-off`,
        { method: "POST" },
      );
      if (!res.ok) {
        setError("Could not dismiss. Try again.");
        setSubmitting(null);
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
      setSubmitting(null);
    }
  }

  async function reenable() {
    setError(null);
    setSubmitting("reenable");
    try {
      const res = await fetch(
        `/api/admin/subscriptions/${subscriptionId}/re-enable-auto-renew`,
        { method: "POST" },
      );
      if (!res.ok) {
        setError("Could not re-enable. Try again.");
        setSubmitting(null);
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
      setSubmitting(null);
    }
  }

  return (
    <div className={styles.inlineReplyRow}>
      <button
        type="button"
        className={styles.focusedHomeCta}
        onClick={reenable}
        disabled={!!submitting}
      >
        {submitting === "reenable" ? "Re enabling..." : "Re enable auto renew"}
      </button>
      <button
        type="button"
        className={styles.inlineReplySecondary}
        onClick={ack}
        disabled={!!submitting}
      >
        {submitting === "ack" ? "Dismissing..." : "Got it"}
      </button>
      {error ? <span className={styles.inlineReplyError}>{error}</span> : null}
    </div>
  );
}

function phraseForTask(t: DerivedTask): { title: string; body: string | null; cta: string } {
  const name = t.client_name;
  switch (t.task_type) {
    case "message_thread": {
      const payload = (t.task_payload ?? {}) as { last_message_body?: string };
      const snippet = (payload.last_message_body ?? "").trim();
      return {
        title: `${name} is waiting on you.`,
        body: snippet ? `"${snippet.slice(0, 200)}${snippet.length > 200 ? "..." : ""}"` : null,
        cta: "Reply",
      };
    }
    case "trial_decision":
      return {
        title: `Decide on ${name}'s trial.`,
        body: "The call wrapped. Take on, decline, or sit with it.",
        cta: "Decide",
      };
    case "cancellation_event":
      return {
        title: `${name}'s cancel needs your review.`,
        body: "Credit or forfeit. The 24 hour rule decides.",
        cta: "Review",
      };
    case "new_student_welcome":
      return {
        title: `${name} is in.`,
        body: "First cycle is paid. Welcome them and lock in the calendar.",
        cta: "Welcome",
      };
    case "new_trial_booked":
      return {
        title: `${name} just booked a free call.`,
        body: "Calendly synced the time to your calendar. Prep when you have a minute.",
        cta: "Open card",
      };
    case "parent_started_scheduling": {
      const payload = (t.task_payload ?? {}) as { slots_booked?: number };
      const booked = payload.slots_booked ?? 0;
      return {
        title: `${name}'s parent is booking lessons.`,
        body:
          booked === 0
            ? "They opened the scheduler. No slots reserved yet."
            : booked === 4
              ? "All four slots reserved. Payment is the next step."
              : `${booked} of 4 slots reserved.`,
        cta: "Open card",
      };
    }
    case "pending_payment":
      return {
        title: `${name}'s lessons are awaiting payment.`,
        body: "All four slots reserved. Parent is on the Stripe page.",
        cta: "Open card",
      };
    case "past_due_opened": {
      const payload = (t.task_payload ?? {}) as { past_due_started_at?: string };
      const since = payload.past_due_started_at;
      const days = since
        ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000))
        : 0;
      return {
        title: `${name}'s card was declined.`,
        body:
          days === 0
            ? "Stripe is auto retrying. Lessons paused while it sorts out."
            : `Day ${days}. Stripe is still retrying. Lessons paused.`,
        cta: "Open card",
      };
    }
    case "vod_dropped": {
      const payload = (t.task_payload ?? {}) as { vod_url?: string };
      return {
        title: `${name} dropped a clip.`,
        body: payload.vod_url ? "Watch it before the call so you walk in informed." : "Watch it before the call so you walk in informed.",
        cta: "Open card",
      };
    }
    case "lesson_authoring_needed": {
      const payload = (t.task_payload ?? {}) as {
        week_number?: number;
        live_call_at?: string | null;
      };
      const week = payload.week_number ?? 0;
      const when = payload.live_call_at
        ? new Date(payload.live_call_at)
        : null;
      const days = when
        ? Math.max(0, Math.floor((when.getTime() - Date.now()) / 86_400_000))
        : null;
      return {
        title: `${name}'s Week ${week} lesson is still a stub.`,
        body:
          days === null
            ? "Slides + voiceover aren't authored yet. Sunday delivery will be empty."
            : days === 0
              ? "Live call is today. Author the slides + voiceover before delivery."
              : `Live call in ${days} ${days === 1 ? "day" : "days"}. Author the slides + voiceover before then.`,
        cta: "Author lesson",
      };
    }
    case "tiktok_daily_reminder":
      return {
        title: "Drop your TikTok comment for today.",
        body: "Pick a Fortnite creator video, leave one expert tactical comment. Keeps the funnel spinning.",
        cta: "Logged it",
      };
    case "subscription_auto_renew_off": {
      const payload = (t.task_payload ?? {}) as {
        cycle_lessons_delivered?: number;
      };
      const delivered = payload.cycle_lessons_delivered ?? 0;
      const remaining = Math.max(0, 4 - delivered);
      return {
        title: `${name}'s auto renew is off.`,
        body:
          remaining > 0
            ? `${remaining} ${remaining === 1 ? "lesson" : "lessons"} left in the cycle, then the subscription ends. Reach out if you want to keep them.`
            : "The cycle is done. The subscription ends at the next cron run.",
        cta: "Open card",
      };
    }
    case "prep_answered": {
      const payload = (t.task_payload ?? {}) as { q1_choice?: string; q2_choice?: string };
      const q1 = payload.q1_choice ? Q1_LABELS[payload.q1_choice] ?? payload.q1_choice : null;
      const q2 = payload.q2_choice ? Q2_LABELS[payload.q2_choice] ?? payload.q2_choice : null;
      const parts: string[] = [];
      if (q1) parts.push(`Frustration: ${q1}.`);
      if (q2) parts.push(`Goal: ${q2}.`);
      return {
        title: `${name} answered the prep questions.`,
        body: parts.length > 0 ? parts.join(" ") : "Read their answers before the call.",
        cta: "Open card",
      };
    }
    default:
      return {
        title: `${name} needs you.`,
        body: null,
        cta: "Open",
      };
  }
}

function formatAge(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const ms = Math.max(0, now - then);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h waiting`;
  const days = Math.floor(hours / 24);
  return `${days}d waiting`;
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "muted";
  hint?: string;
}) {
  return (
    <div
      className={`${styles.stat} ${
        tone === "warn" ? styles.statWarn : tone === "muted" ? styles.statMuted : ""
      }`}
      title={hint}
    >
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}

export function TrialCardView({
  card,
  router,
}: {
  card: TrialCard;
  router: ReturnType<typeof useRouter>;
}) {
  const player = card.player;
  const parent = card.parent;
  const completed = new Set(card.completed_quest_keys);
  const completedCount = QUEST_ORDER.filter((k) => completed.has(k)).length;

  if (!player) {
    return (
      <article className={styles.trialCard}>
        <div className={styles.trialHeader}>
          <span className={styles.trialName}>Player record missing</span>
        </div>
        <div className={styles.empty}>Subscription row exists without a matching player. Investigate.</div>
      </article>
    );
  }

  return (
    <article id={`client-${player.id}`} className={styles.trialCard}>
      <header className={styles.trialHeader}>
        <div>
          <div className={styles.trialName}>
            {player.first_name}, {player.age}
          </div>
          <div className={styles.trialSub}>
            IGN {player.fortnite_username ?? "(none)"} ·{" "}
            {player.current_rank ?? "no rank"} · {player.platform ?? "platform unknown"} ·{" "}
            {player.hours_per_week !== null ? `${player.hours_per_week} hrs/wk` : "hours unknown"}
          </div>
        </div>
        <div className={styles.prepBadge} data-done={completedCount === 4}>
          Prep {completedCount}/4
        </div>
      </header>

      <div className={styles.questRow}>
        {QUEST_ORDER.map((key) => (
          <span
            key={key}
            className={`${styles.questChip} ${completed.has(key) ? styles.questChipDone : ""}`}
          >
            {completed.has(key) ? "✓ " : ""}
            {QUEST_LABELS[key]}
          </span>
        ))}
      </div>

      {parent ? (
        <div className={styles.parentRow}>
          <span className={styles.parentLabel}>Parent</span>
          <span>{parent.first_name}</span>
          <a className={styles.linkLime} href={`mailto:${parent.email}`}>
            {parent.email}
          </a>
        </div>
      ) : null}

      {player.discord_username ? (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Discord</span>
          <code className={styles.code}>{player.discord_username}</code>
        </div>
      ) : null}

      {card.latest_vod_url ? (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>VOD</span>
          <a
            className={styles.linkLime}
            href={card.latest_vod_url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {card.latest_vod_url}
          </a>
        </div>
      ) : null}

      {card.prep ? (
        <div className={styles.prepBlock}>
          <div className={styles.prepRow}>
            <span className={styles.metaLabel}>Frustration</span>
            <span>
              {Q1_LABELS[card.prep.q1_choice] ?? card.prep.q1_choice}
              {card.prep.q1_other_text ? ` — ${card.prep.q1_other_text}` : ""}
            </span>
          </div>
          <div className={styles.prepRow}>
            <span className={styles.metaLabel}>Goal</span>
            <span>
              {Q2_LABELS[card.prep.q2_choice] ?? card.prep.q2_choice}
              {card.prep.q2_other_text ? ` — ${card.prep.q2_other_text}` : ""}
            </span>
          </div>
          <div className={styles.prepRow}>
            <span className={styles.metaLabel}>Rewatch</span>
            <span>{card.prep.q3_reflection}</span>
          </div>
        </div>
      ) : null}

      <StageCPanel playerId={player.id} kidFirstName={player.first_name} router={router} />

      <div className={styles.messagesBlock}>
        <div className={styles.fieldLabel}>Messages with {player.first_name}</div>
        <MessageThread
          initialMessages={card.messages}
          viewerRole="coach"
          kidFirstName={player.first_name}
          endpoint="/api/admin/message"
          playerId={player.id}
        />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Stage C panel — Tim's post-call decision tree per CLAUDE.md.
// ---------------------------------------------------------------------------

type StageCMode =
  | { kind: "idle" }
  | { kind: "drafting" }
  | { kind: "submitting_takeon" }
  | { kind: "submitted_takeon"; approval_url: string }
  | { kind: "confirming_decline" }
  | { kind: "submitting_decline" }
  | { kind: "submitted_decline" }
  | { kind: "error"; message: string };

type Week = {
  kid_facing_title: string;
  parent_facing_skill: string;
  is_vod_review: boolean;
};

const EMPTY_WEEK: Week = {
  kid_facing_title: "",
  parent_facing_skill: "",
  is_vod_review: false,
};

function StageCPanel({
  playerId,
  kidFirstName,
  router,
}: {
  playerId: string;
  kidFirstName: string;
  router: ReturnType<typeof useRouter>;
}) {
  const [mode, setMode] = useState<StageCMode>({ kind: "idle" });
  const [note, setNote] = useState("");
  const [weeks, setWeeks] = useState<Week[]>([
    { ...EMPTY_WEEK },
    { ...EMPTY_WEEK },
    { ...EMPTY_WEEK },
    { ...EMPTY_WEEK },
  ]);

  function updateWeek(i: number, patch: Partial<Week>) {
    setWeeks((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  }

  function canSubmit(): boolean {
    if (note.trim().length < 1) return false;
    for (const w of weeks) {
      if (!w.is_vod_review && (w.kid_facing_title.trim().length < 1 || w.parent_facing_skill.trim().length < 1)) {
        return false;
      }
    }
    return true;
  }

  async function submitTakeOn() {
    setMode({ kind: "submitting_takeon" });
    try {
      const res = await fetch("/api/admin/conversion/take-on", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player_id: playerId,
          personalization_note: note.trim(),
          weeks: weeks.map((w) => ({
            kid_facing_title: w.kid_facing_title.trim(),
            parent_facing_skill: w.parent_facing_skill.trim(),
            is_vod_review: w.is_vod_review,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        approval_url?: string;
        error?: string;
        warning?: string;
      };
      if (!res.ok || !body.ok) {
        setMode({ kind: "error", message: body.error ?? "Take on failed." });
        return;
      }
      setMode({ kind: "submitted_takeon", approval_url: body.approval_url ?? "" });
      router.refresh();
    } catch {
      setMode({ kind: "error", message: "Network error." });
    }
  }

  async function submitDecline() {
    setMode({ kind: "submitting_decline" });
    try {
      const res = await fetch("/api/admin/conversion/decline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player_id: playerId }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setMode({ kind: "error", message: body.error ?? "Decline failed." });
        return;
      }
      setMode({ kind: "submitted_decline" });
      router.refresh();
    } catch {
      setMode({ kind: "error", message: "Network error." });
    }
  }

  if (mode.kind === "submitted_takeon") {
    return (
      <div className={styles.stageCDone}>
        <div className={styles.stageCDoneTitle}>Curriculum sent to {kidFirstName}&apos;s parent.</div>
        <div className={styles.hint}>They get an email with the plan and the approval link.</div>
        {mode.approval_url ? (
          <a
            href={mode.approval_url}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.linkLime}
          >
            Open approval link
          </a>
        ) : null}
      </div>
    );
  }
  if (mode.kind === "submitted_decline") {
    return (
      <div className={styles.stageCDone}>
        <div className={styles.stageCDoneTitle}>Marked as not the right fit.</div>
        <div className={styles.hint}>The parent got an email with free creator recommendations.</div>
      </div>
    );
  }
  return (
    <div className={styles.stageCBlock}>
      <div className={styles.fieldLabel}>After the trial call</div>

      {mode.kind === "idle" || mode.kind === "error" ? (
        <>
          <div className={styles.stageCRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setMode({ kind: "drafting" })}
            >
              Take {kidFirstName} on
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setMode({ kind: "confirming_decline" })}
            >
              Not the right fit
            </button>
          </div>
          {mode.kind === "error" ? (
            <div className={styles.alert}>{mode.message}</div>
          ) : null}
        </>
      ) : null}

      {mode.kind === "confirming_decline" || mode.kind === "submitting_decline" ? (
        <div className={styles.stageCConfirm}>
          <div className={styles.cardBody}>
            Decline {kidFirstName} for paid coaching? An email goes out with free
            creator recommendations and the account stays open.
          </div>
          <div className={styles.stageCRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={submitDecline}
              disabled={mode.kind === "submitting_decline"}
            >
              {mode.kind === "submitting_decline" ? "Sending..." : "Send decline"}
            </button>
            <button
              type="button"
              className={styles.tertiaryBtn}
              onClick={() => setMode({ kind: "idle" })}
              disabled={mode.kind === "submitting_decline"}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode.kind === "drafting" || mode.kind === "submitting_takeon" ? (
        <div className={styles.drafter}>
          <div className={styles.cardBody}>
            Draft {kidFirstName}&apos;s 4 week plan. The parent gets the
            translation in their email, so make the parent skill describe a
            real-world capability, not the Fortnite move.
          </div>
          {weeks.map((w, i) => (
            <div key={i} className={styles.weekBlock}>
              <div className={styles.weekHeader}>
                <span className={styles.weekLabel}>Week {i + 1}</span>
                <label className={styles.weekVodToggle}>
                  <input
                    type="checkbox"
                    checked={w.is_vod_review}
                    onChange={(e) => updateWeek(i, { is_vod_review: e.target.checked })}
                  />
                  VOD review week
                </label>
              </div>
              {w.is_vod_review ? (
                <div className={styles.weekVodNote}>
                  VOD week. Defaults to {kidFirstName}&apos;s most recent clip.
                  You can swap the URL and add talking points later.
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Kid facing title (Fortnite term, e.g. Tunneling)"
                    value={w.kid_facing_title}
                    onChange={(e) => updateWeek(i, { kid_facing_title: e.target.value })}
                    className={styles.input}
                    maxLength={120}
                  />
                  <input
                    type="text"
                    placeholder="Parent facing skill (e.g. Defensive building under pressure)"
                    value={w.parent_facing_skill}
                    onChange={(e) => updateWeek(i, { parent_facing_skill: e.target.value })}
                    className={styles.input}
                    maxLength={240}
                  />
                </>
              )}
            </div>
          ))}
          <textarea
            placeholder={`Two sentence personalization note for ${kidFirstName}'s parent. Why this plan, why now.`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={styles.input}
            rows={3}
            maxLength={500}
          />
          <div className={styles.stageCRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={submitTakeOn}
              disabled={!canSubmit() || mode.kind === "submitting_takeon"}
            >
              {mode.kind === "submitting_takeon" ? "Sending..." : "Send to parent"}
            </button>
            <button
              type="button"
              className={styles.tertiaryBtn}
              onClick={() => setMode({ kind: "idle" })}
              disabled={mode.kind === "submitting_takeon"}
            >
              Cancel
            </button>
          </div>
          {!canSubmit() ? (
            <div className={styles.hint}>
              Fill in both fields for every non VOD week and write the personalization note to enable Send.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
