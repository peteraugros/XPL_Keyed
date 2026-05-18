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

export default function AdminClient({
  coachName,
  stats,
  trialCards,
  activeRows,
}: {
  coachName: string;
  stats: {
    payingCount: number;
    capacity: number;
    trialsThisWeek: number;
    waitlistCount: number;
    waitlistOldestDays: number | null;
  };
  trialCards: TrialCard[];
  activeRows: ActiveRow[];
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
          <span className={styles.coachName}>{coachName}</span>
          <button type="button" onClick={onSignOut} className={styles.signOutBtn}>
            Sign out
          </button>
        </div>
      </header>

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
              <li key={row.subscription_id} className={styles.activeRow}>
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
    <article className={styles.trialCard}>
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
        </div>
      ) : null}
    </div>
  );
}
