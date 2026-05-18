"use client";

// Tim's coach dashboard surface. Coach-tone palette: same dark bg + lime
// accents as the parent /portal, but no rarity colors or XP gamification.
// Functional badges only.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import MessageThread, { type MessageRow } from "@/components/MessageThread";

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

type Player = {
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
type Parent = { family_id: string; first_name: string; email: string };
type Prep = {
  q1_choice: string;
  q1_other_text: string | null;
  q2_choice: string;
  q2_other_text: string | null;
  q3_reflection: string;
};

type TrialCard = {
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

type ActiveRow = {
  subscription_id: string;
  player_id: string;
  player_first_name: string;
  parent_first_name: string;
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

export default function AdminClient({
  coachName,
  coachMode,
  stats,
  tasks,
  trialCards,
  activeRows,
  pipelineCards,
  waitlistEntries,
  returnedStucks,
}: {
  coachName: string;
  coachMode: "focused" | "command";
  stats: {
    payingCount: number;
    capacity: number;
    trialsThisWeek: number;
    waitlistCount: number;
    waitlistOldestDays: number | null;
  };
  tasks: DerivedTask[];
  trialCards: TrialCard[];
  activeRows: ActiveRow[];
  pipelineCards: PipelineCard[];
  waitlistEntries: WaitlistEntry[];
  returnedStucks: ReturnedStuck[];
}) {
  const router = useRouter();

  async function onSignOut() {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch { /* fall through */ }
    (router.replace as (u: string) => void)("/login");
    router.refresh();
  }

  return (
    <div className={styles.frame}>
      <header className={styles.topBar}>
        <div className={styles.brand}>XPL KEYED ADMIN</div>
        <div className={styles.topMeta}>
          <ModeToggle current={coachMode} router={router} />
          <a href="/admin/lessons" className={styles.signOutBtn}>
            Lesson library
          </a>
          <span className={styles.coachName}>{coachName}</span>
          <button type="button" onClick={onSignOut} className={styles.signOutBtn}>
            Sign out
          </button>
        </div>
      </header>

      <StuckReturnBanner returnedStucks={returnedStucks} />

      {coachMode === "command" ? (
        <CommandPipeline pipelineCards={pipelineCards} waitlistEntries={waitlistEntries} stats={stats} />
      ) : (
        <FocusedHome tasks={tasks} />
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

      <section className={styles.block}>
        <h2 className={styles.blockHeader}>
          New trials
          <span className={styles.blockCount}>{trialCards.length}</span>
        </h2>
        {trialCards.length === 0 ? (
          <div className={styles.empty}>
            No trials in the queue. Free intro calls will land here as families book.
          </div>
        ) : (
          <div className={styles.trialGrid}>
            {trialCards.map((card) => (
              <TrialCardView key={card.subscription_id} card={card} router={router} />
            ))}
          </div>
        )}
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockHeader}>
          Active clients
          <span className={styles.blockCount}>{activeRows.length}</span>
        </h2>
        {activeRows.length === 0 ? (
          <div className={styles.empty}>
            No active subscriptions yet. The first paid cycle lands here after Stage C conversion.
          </div>
        ) : (
          <ul className={styles.activeList}>
            {activeRows.map((row) => (
              <li key={row.subscription_id} id={`client-${row.player_id}`} className={styles.activeRow}>
                <div className={styles.activeHeader}>
                  <div className={styles.activeName}>
                    <span className={styles.activeKid}>{row.player_first_name}</span>
                    <span className={styles.activeSubtle}>
                      Parent: {row.parent_first_name}
                    </span>
                  </div>
                  <div className={styles.activeMeta}>
                    <span className={styles.metaPill}>
                      Cycle {row.cycle_lessons_delivered}/4
                    </span>
                    <span className={styles.metaPill}>
                      Cancels {row.cycle_cancels_used}/2
                    </span>
                  </div>
                </div>
                <div className={styles.messagesBlock}>
                  <div className={styles.fieldLabel}>Messages with {row.player_first_name}</div>
                  <MessageThread
                    initialMessages={row.messages}
                    viewerRole="coach"
                    kidFirstName={row.player_first_name}
                    endpoint="/api/admin/message"
                    playerId={row.player_id}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className={styles.footer}>
        Tim's admin. Stage C and lesson library land next.
      </footer>
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
                      href={`#client-${c.player_id}`}
                      className={`${styles.pipelineCard} ${c.waiting_on === "TIM" ? styles.pipelineCardWaitingTim : ""}`}
                    >
                      <div className={styles.pipelineCardName}>{c.player_first_name}</div>
                      <div className={styles.pipelineCardMeta}>
                        {c.lifecycle_state === "TRIAL_PREP" || c.lifecycle_state === "TRIAL_SCHEDULED" ? (
                          <span>prep {c.prep_completed}/4</span>
                        ) : c.lifecycle_state === "ACTIVE" ? (
                          <span>cyc {c.cycle_lessons_delivered}/4 · cancels {c.cycle_cancels_used}/2</span>
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
function FocusedHome({ tasks }: { tasks: DerivedTask[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  // Inline reply state for the top task when it's a message_thread.
  const [replyBody, setReplyBody] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySent, setReplySent] = useState(false);

  if (tasks.length === 0) {
    return (
      <section className={styles.focusedHomeEmpty}>
        <div className={styles.focusedHomeEyebrow}>Home</div>
        <div className={styles.focusedHomeEmptyTitle}>Nothing waiting on you.</div>
        <div className={styles.focusedHomeEmptyBody}>
          Quiet inbox. Tim&apos;s on top of it. Stay loose.
        </div>
      </section>
    );
  }

  const topTask = tasks[0];
  const remaining = tasks.slice(1);
  const phrasing = phraseForTask(topTask);
  const ageStr = formatAge(topTask.age_in_state);
  const isMessageThread = topTask.task_type === "message_thread";

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
    <section className={styles.focusedHome}>
      <div className={styles.focusedHomeEyebrow}>Next thing</div>
      <h2 className={styles.focusedHomeTitle}>{phrasing.title}</h2>
      {phrasing.body ? (
        <p className={styles.focusedHomeBody}>{phrasing.body}</p>
      ) : null}
      <div className={styles.focusedHomeMeta}>
        <span className={styles.focusedHomeKid}>{topTask.client_name}</span>
        <span className={styles.focusedHomeDot}>·</span>
        <span className={styles.focusedHomeAge}>{ageStr}</span>
        <span className={styles.focusedHomeDot}>·</span>
        <StuckButton task={topTask} variant="link" />
      </div>

      {isMessageThread && !replySent ? (
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
              href={`#client-${topTask.client_id}`}
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
      ) : (
        <a href={`#client-${topTask.client_id}`} className={styles.focusedHomeCta}>
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
                    <a href={`#client-${t.client_id}`} className={styles.focusedHomeMoreCta}>
                      {p.cta}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
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

function TrialCardView({
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

  const [discordUrl, setDiscordUrl] = useState<string>(
    player?.discord_channel_url ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function saveDiscordUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!player) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/players/${player.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discord_channel_url: discordUrl.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Save failed. Try again.");
        setSubmitting(false);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    }
    setSubmitting(false);
  }

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
          <span className={styles.metaLabel}>Kid Discord</span>
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

      <form className={styles.discordForm} onSubmit={saveDiscordUrl}>
        <label className={styles.fieldLabel} htmlFor={`discord-${player.id}`}>
          Discord channel invite
        </label>
        <div className={styles.discordRow}>
          <input
            id={`discord-${player.id}`}
            type="url"
            inputMode="url"
            placeholder="https://discord.gg/..."
            value={discordUrl}
            onChange={(e) => setDiscordUrl(e.target.value)}
            className={styles.input}
          />
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={submitting}
          >
            {submitting ? "Saving" : savedAt ? "Saved" : "Save"}
          </button>
        </div>
        <div className={styles.hint}>
          Paste the per-kid channel invite from your server. Parent and player views read this.
        </div>
        {error ? <div className={styles.alert}>{error}</div> : null}
      </form>

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

      <StageCPanel playerId={player.id} kidFirstName={player.first_name} router={router} />
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
  | { kind: "still_deciding" }
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
  if (mode.kind === "still_deciding") {
    return (
      <div className={styles.stageCDone}>
        <div className={styles.stageCDoneTitle}>Saved for review.</div>
        <div className={styles.hint}>Come back to this card when you decide.</div>
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
            <button
              type="button"
              className={styles.tertiaryBtn}
              onClick={() => setMode({ kind: "still_deciding" })}
            >
              Still deciding
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
