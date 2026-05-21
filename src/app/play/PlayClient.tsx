"use client";

// Kid's quest log surface. Sibling to /portal but heavily interactive and
// gamified per CLAUDE.md: rarity colors, +25 XP per quest, sequential
// unlock for Q3 (locked until Q2 done), parent-visibility reminder in the
// footer.
//
// Three POSTs back to /api/play/* — each route inserts the data row plus
// the matching quest_completions marker. After a successful submit we
// call router.refresh() so the server-fetched initial state stays the
// source of truth for the page on next render.
//
// Deferred polish (CLAUDE.md): confetti on quest completion, +25 XP
// floats animating off the row, level-up sound. The XP bar transitions
// already respect prefers-reduced-motion via the CSS.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type QuestKey = "signup" | "drop_vod" | "answer_questions" | "join_discord";

type PrepState = {
  q1_choice: string;
  q1_other_text: string | null;
  q2_choice: string;
  q2_other_text: string | null;
  q3_reflection: string;
} | null;

type Option = { slug: string; label: string };

const Q1_OPTIONS: Option[] = [
  { slug: "lose_fights", label: "I lose fights I should win" },
  { slug: "build_slow", label: "My building or edits are too slow" },
  { slug: "third_partied", label: "I keep getting third partied" },
  { slug: "tilt", label: "I tilt and start playing worse" },
  { slug: "stuck_rank", label: "I'm stuck at the same rank" },
  { slug: "streamer_gap", label: "I watch streamers but I can't actually do what they do" },
  { slug: "other", label: "Something else" },
];

const Q2_OPTIONS: Option[] = [
  { slug: "stop_dying", label: "Just stop dying so fast" },
  { slug: "beat_friends", label: "Beat my friends consistently" },
  { slug: "hit_unreal", label: "Hit Unreal" },
  { slug: "top_10k_cashcup", label: "Top 10K in a Cash Cup" },
  { slug: "fncs", label: "Make it to FNCS" },
  { slug: "prize_money", label: "Win prize money in comp" },
  { slug: "other", label: "Something else" },
];

const RARITY: Record<QuestKey, string> = {
  signup: styles.uncommon,
  drop_vod: styles.rare,
  answer_questions: styles.epic,
  join_discord: styles.legendary,
};

type CurriculumWeek = {
  week_number: number;
  is_vod_review: boolean;
  fortnite_label: string | null;
};

export default function PlayClient({
  playerFirstName,
  fortniteUsername,
  initialCompletedQuests,
  initialVodUrl,
  initialPrep,
  subscriptionStatus,
  cycleLessonsDelivered,
  curriculumWeeks,
  trialCallAt,
  discordChannelUrl,
}: {
  playerFirstName: string;
  fortniteUsername: string | null;
  initialCompletedQuests: string[];
  initialVodUrl: string | null;
  subscriptionStatus: string;
  cycleLessonsDelivered: number;
  curriculumWeeks: CurriculumWeek[];
  initialPrep: PrepState;
  trialCallAt: string | null;
  discordChannelUrl: string | null;
}) {
  const router = useRouter();

  const [completed, setCompleted] = useState<Set<string>>(
    () => new Set(initialCompletedQuests),
  );
  const [vodUrl, setVodUrl] = useState<string | null>(initialVodUrl);
  const [prep, setPrep] = useState<PrepState>(initialPrep);

  // Local-only UI state.
  const [vodInput, setVodInput] = useState<string>("");
  const [vodSubmitting, setVodSubmitting] = useState(false);
  const [vodError, setVodError] = useState<string | null>(null);

  const [q1Slug, setQ1Slug] = useState<string>("");
  const [q1Other, setQ1Other] = useState<string>("");
  const [q2Slug, setQ2Slug] = useState<string>("");
  const [q2Other, setQ2Other] = useState<string>("");
  const [q3Text, setQ3Text] = useState<string>("");
  const [prepSubmitting, setPrepSubmitting] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  const [discordSubmitting, setDiscordSubmitting] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);

  const isDone = (key: QuestKey) => completed.has(key);
  // Phase discriminator. trial → quest log. active → cycle counter + plan.
  // paused (past_due / pending_cancel) → quiet "on hold" copy, hide quests.
  // ended (canceled / declined) → quiet wrap up copy, keep messages.
  type Phase = "trial" | "active" | "paused" | "ended";
  const phase: Phase =
    subscriptionStatus === "active"
      ? "active"
      : subscriptionStatus === "past_due" || subscriptionStatus === "pending_cancel"
        ? "paused"
        : subscriptionStatus === "canceled" || subscriptionStatus === "declined"
          ? "ended"
          : "trial";
  const isTrial = phase === "trial";
  const isActive = phase === "active";
  const isPaused = phase === "paused";
  const isEnded = phase === "ended";
  const totalQuests = 4;
  const xpPercent = useMemo(
    () => (completed.size / totalQuests) * 100,
    [completed],
  );

  async function submitVod(e: React.FormEvent) {
    e.preventDefault();
    setVodError(null);
    const url = vodInput.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      setVodError("Paste a link starting with https://. Twitch, YouTube, Medal, Streamable all work.");
      return;
    }
    setVodSubmitting(true);
    try {
      const res = await fetch("/api/play/vod", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setVodError(body.error ?? "Something went wrong. Try again.");
        setVodSubmitting(false);
        return;
      }
      setVodUrl(url);
      setCompleted((prev) => new Set(prev).add("drop_vod"));
      setVodInput("");
      router.refresh();
    } catch {
      setVodError("We could not reach the server. Try again.");
    }
    setVodSubmitting(false);
  }

  async function submitPrep(e: React.FormEvent) {
    e.preventDefault();
    setPrepError(null);
    if (!q1Slug) return setPrepError("Tap one option for the first question.");
    if (!q2Slug) return setPrepError("Tap one option for the second question.");
    if (q3Text.trim().length < 1)
      return setPrepError("Even one word is fine for the last question.");
    if (q1Slug === "other" && !q1Other.trim())
      return setPrepError('You picked "Something else" for the first one. Type a quick sentence.');
    if (q2Slug === "other" && !q2Other.trim())
      return setPrepError('You picked "Something else" for the second one. Type a quick sentence.');

    setPrepSubmitting(true);
    try {
      const res = await fetch("/api/play/prep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          q1_choice: q1Slug,
          q1_other_text: q1Slug === "other" ? q1Other.trim() : null,
          q2_choice: q2Slug,
          q2_other_text: q2Slug === "other" ? q2Other.trim() : null,
          q3_reflection: q3Text.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPrepError(body.error ?? "Something went wrong. Try again.");
        setPrepSubmitting(false);
        return;
      }
      setPrep({
        q1_choice: q1Slug,
        q1_other_text: q1Slug === "other" ? q1Other.trim() : null,
        q2_choice: q2Slug,
        q2_other_text: q2Slug === "other" ? q2Other.trim() : null,
        q3_reflection: q3Text.trim(),
      });
      setCompleted((prev) => new Set(prev).add("answer_questions"));
      router.refresh();
    } catch {
      setPrepError("We could not reach the server. Try again.");
    }
    setPrepSubmitting(false);
  }

  async function claimDiscordJoin() {
    setDiscordError(null);
    setDiscordSubmitting(true);
    try {
      const res = await fetch("/api/play/discord-join", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDiscordError(body.error ?? "Something went wrong. Try again.");
        setDiscordSubmitting(false);
        return;
      }
      setCompleted((prev) => new Set(prev).add("join_discord"));
      router.refresh();
    } catch {
      setDiscordError("We could not reach the server. Try again.");
    }
    setDiscordSubmitting(false);
  }

  const q3Unlocked = isDone("drop_vod");

  return (
    <div className={styles.hq}>
      <section className={styles.hero}>
        <div className={styles.heroEyebrow}>
          {isActive
            ? "HQ. Active."
            : isPaused
              ? "HQ. On hold."
              : isEnded
                ? "HQ."
                : "HQ. Free trial."}
        </div>
        <h1 className={styles.heroTitle}>What up, {playerFirstName}.</h1>
        <p className={styles.heroBody}>
          {isActive
            ? `Lesson ${cycleLessonsDelivered + 1} of 4 incoming Sunday. Hit Tim in Comms for anything between drops.`
            : isPaused
              ? "Lessons are on a brief hold. Your parents are sorting it. Tim still sees your messages in Comms."
              : isEnded
                ? "Coaching wrapped for now. Your thread with Tim is still open from Comms."
                : "Your free call is locked in. Finish your prep so we can hit the ground running."}
        </p>
        {fortniteUsername ? (
          <div className={styles.heroIgn}>
            IGN <span className={styles.heroIgnValue}>{fortniteUsername}</span>
          </div>
        ) : null}
      </section>

      {trialCallAt && !isActive && !isEnded ? (
        <TrialCallCard
          trialCallAt={trialCallAt}
          discordChannelUrl={discordChannelUrl}
        />
      ) : null}

      {isActive ? (
        <>
          <section className={styles.card}>
            <div className={styles.cardEyebrow}>This cycle</div>
            <h2 className={styles.cardTitle}>
              Lesson {cycleLessonsDelivered} of 4 dropped
            </h2>
            <p className={styles.cardBody}>
              One lesson lands every Sunday. Tim sends it with a voiceover.
              You watch when you have time before the live call that week.
            </p>
          </section>

          {curriculumWeeks.length === 4 ? (
            <section className={styles.card}>
              <div className={styles.cardEyebrow}>Your 4 week plan</div>
              <h2 className={styles.cardTitle}>What Tim is teaching</h2>
              <ul className={styles.activeWeekList}>
                {curriculumWeeks.map((w) => (
                  <li key={w.week_number} className={styles.activeWeekRow}>
                    <span className={styles.activeWeekNum}>Wk {w.week_number}</span>
                    <span className={styles.activeWeekLabel}>
                      {w.is_vod_review ? "VOD review" : (w.fortnite_label ?? "Coming")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.subtle}>
                Tim is putting the slides and voiceover together. They drop
                here Sunday by Sunday.
              </p>
            </section>
          ) : null}
        </>
      ) : null}

      {isTrial ? (
        <section className={styles.xpStrip}>
          <div className={styles.xpRow}>
            <span className={styles.xpLabel}>XP</span>
            <span className={styles.xpCount}>{completed.size * 25} / 100</span>
          </div>
          <div className={styles.xpBar} aria-hidden>
            <div className={styles.xpFill} style={{ width: `${xpPercent}%` }} />
          </div>
          <div className={styles.xpHint}>
            Earn XP for each quest. More coming after your first paid cycle.
          </div>
        </section>
      ) : null}

      {isPaused ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>On hold</div>
          <h2 className={styles.cardTitle}>Lessons paused</h2>
          <p className={styles.cardBody}>
            {subscriptionStatus === "past_due"
              ? "We hit a payment snag. Your parents are sorting it. Nothing about your progress changes, the cycle just waits."
              : "Your subscription is winding down. Your parents have an Undo link if they change their mind."}
          </p>
          <p className={styles.subtle}>
            Want to ping Tim? Message him below. He still sees everything you send.
          </p>
        </section>
      ) : null}

      {isEnded ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Wrapped</div>
          <h2 className={styles.cardTitle}>Coaching is paused for now</h2>
          <p className={styles.cardBody}>
            {subscriptionStatus === "declined"
              ? "Tim suggested some other paths after the trial. The message thread with him is still open if you want to stay in touch."
              : "Your subscription ended. Your messages and history are saved. Your parents can restart any time."}
          </p>
        </section>
      ) : null}

      {/* ============ QUEST LOG (trial-state only) ============ */}
      {isTrial && (
      <section className={styles.questBlock}>
        <h2 className={styles.questHeader}>Quest log</h2>

        {/* Quest 1 — Signup (always done at intake) */}
        <article className={`${styles.quest} ${RARITY.signup} ${styles.questDone}`}>
          <header className={styles.questHead}>
            <span className={styles.questBadge}>1</span>
            <h3 className={styles.questTitle}>Sign up, DONE!</h3>
          </header>
          <p className={styles.questCopy}>Welcome to the squad.</p>
        </article>

        {/* Quest 2 — Drop a VOD */}
        <article
          className={`${styles.quest} ${RARITY.drop_vod} ${
            isDone("drop_vod") ? styles.questDone : ""
          }`}
        >
          <header className={styles.questHead}>
            <span className={styles.questBadge}>2</span>
            <h3 className={styles.questTitle}>Drop a VOD</h3>
            <span className={styles.questXp}>
              {isDone("drop_vod") ? "+25 XP earned" : "+25 XP"}
            </span>
          </header>
          <p className={styles.questCopy}>
            Paste a clip from a recent ranked game you wish had gone better.
            Tim watches it before the call so the time is spent coaching.
          </p>

          {isDone("drop_vod") ? (
            <div className={styles.savedRow}>
              <span className={styles.savedLabel}>Submitted</span>
              <a
                href={vodUrl ?? "#"}
                className={styles.savedLink}
                target="_blank"
                rel="noreferrer noopener"
              >
                {vodUrl}
              </a>
            </div>
          ) : (
            <form className={styles.inlineForm} onSubmit={submitVod}>
              <input
                type="url"
                inputMode="url"
                required
                placeholder="https://"
                value={vodInput}
                onChange={(e) => setVodInput(e.target.value)}
                className={styles.input}
              />
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={vodSubmitting || !vodInput.trim()}
              >
                {vodSubmitting ? "Saving..." : "Submit clip"}
              </button>
              {vodError ? <div className={styles.alert}>{vodError}</div> : null}
              <div className={styles.subtle}>
                Twitch clips, YouTube videos, Medal links, Streamable. Any
                public link works.
              </div>
            </form>
          )}
        </article>

        {/* Quest 3 — Answer 3 questions (locked until Q2 done) */}
        <article
          className={`${styles.quest} ${RARITY.answer_questions} ${
            isDone("answer_questions") ? styles.questDone : ""
          } ${q3Unlocked ? "" : styles.questLocked}`}
        >
          <header className={styles.questHead}>
            <span className={styles.questBadge}>3</span>
            <h3 className={styles.questTitle}>Answer 3 quick questions</h3>
            <span className={styles.questXp}>
              {isDone("answer_questions") ? "+25 XP earned" : "+25 XP"}
            </span>
          </header>
          {!q3Unlocked ? (
            <p className={styles.questCopy}>
              Unlocks after you drop your VOD. You will rewatch it for the last
              question.
            </p>
          ) : isDone("answer_questions") && prep ? (
            <div className={styles.savedBlock}>
              <div className={styles.savedQ}>
                <span className={styles.savedLabel}>Frustration</span>
                <span>
                  {labelFor(Q1_OPTIONS, prep.q1_choice)}
                  {prep.q1_other_text ? `. ${prep.q1_other_text}` : ""}
                </span>
              </div>
              <div className={styles.savedQ}>
                <span className={styles.savedLabel}>Goal</span>
                <span>
                  {labelFor(Q2_OPTIONS, prep.q2_choice)}
                  {prep.q2_other_text ? `. ${prep.q2_other_text}` : ""}
                </span>
              </div>
              <div className={styles.savedQ}>
                <span className={styles.savedLabel}>Rewatch</span>
                <span>{prep.q3_reflection}</span>
              </div>
            </div>
          ) : (
            <form className={styles.prepForm} onSubmit={submitPrep}>
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>
                  What is the most frustrating thing about your game right now?
                </legend>
                <div className={styles.optionGrid}>
                  {Q1_OPTIONS.map((opt) => (
                    <button
                      key={opt.slug}
                      type="button"
                      className={`${styles.option} ${q1Slug === opt.slug ? styles.optionSelected : ""}`}
                      onClick={() => setQ1Slug(opt.slug)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {q1Slug === "other" ? (
                  <input
                    type="text"
                    maxLength={140}
                    placeholder="One sentence is fine"
                    value={q1Other}
                    onChange={(e) => setQ1Other(e.target.value)}
                    className={styles.input}
                  />
                ) : null}
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>
                  Where are you trying to get to?
                </legend>
                <div className={styles.optionGrid}>
                  {Q2_OPTIONS.map((opt) => (
                    <button
                      key={opt.slug}
                      type="button"
                      className={`${styles.option} ${q2Slug === opt.slug ? styles.optionSelected : ""}`}
                      onClick={() => setQ2Slug(opt.slug)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {q2Slug === "other" ? (
                  <input
                    type="text"
                    maxLength={140}
                    placeholder="One sentence is fine"
                    value={q2Other}
                    onChange={(e) => setQ2Other(e.target.value)}
                    className={styles.input}
                  />
                ) : null}
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>
                  Watch your clip one more time. What should have happened
                  differently?
                </legend>
                {vodUrl ? (
                  <a
                    href={vodUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.rewatchLink}
                  >
                    Open your clip
                  </a>
                ) : null}
                <textarea
                  rows={3}
                  maxLength={800}
                  placeholder="Even one word is fine. Tim just wants to see how you watch your gameplay."
                  value={q3Text}
                  onChange={(e) => setQ3Text(e.target.value)}
                  className={styles.textarea}
                />
              </fieldset>

              {prepError ? <div className={styles.alert}>{prepError}</div> : null}
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={prepSubmitting}
              >
                {prepSubmitting ? "Saving..." : "Submit answers"}
              </button>
            </form>
          )}
        </article>

        {/* Quest 4 — Join Discord */}
        <article
          className={`${styles.quest} ${RARITY.join_discord} ${
            isDone("join_discord") ? styles.questDone : ""
          }`}
        >
          <header className={styles.questHead}>
            <span className={styles.questBadge}>4</span>
            <h3 className={styles.questTitle}>Join Tim's Discord</h3>
            <span className={styles.questXp}>
              {isDone("join_discord") ? "+25 XP earned" : "+25 XP"}
            </span>
          </header>
          <p className={styles.questCopy}>
            Tim will send you an invite to the XPL Keyed coaching server. Look
            for it in Discord, accept it, then tap below. Your private channel
            goes live after you join.
          </p>
          {isDone("join_discord") ? (
            <div className={styles.savedRow}>
              <span className={styles.savedLabel}>You're in the server</span>
            </div>
          ) : (
            <div className={styles.discordRow}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={claimDiscordJoin}
                disabled={discordSubmitting}
              >
                {discordSubmitting ? "Saving..." : "I accepted the invite"}
              </button>
              {discordError ? <div className={styles.alert}>{discordError}</div> : null}
            </div>
          )}
        </article>
      </section>
      )}

      <p className={styles.parentReminder}>
        Your parents can see every message and quest you submit. No DMs with Tim. Coaching only happens in the server.
      </p>
    </div>
  );
}

function labelFor(options: Option[], slug: string): string {
  return options.find((o) => o.slug === slug)?.label ?? slug;
}

// ---------------------------------------------------------------------------
// TrialCallCard — live countdown to the kid's free intro call.
// Renders nothing if the call has already happened (>2hr past).
// Shows a countdown until 15 min before. Then enables the "Join Discord
// call" button, deep-linking to the kid's private channel URL if Tim
// has pasted one; otherwise points at xplkeyed.com (a fallback that
// won't help, but Tim should always paste the channel URL before the
// call).
// ---------------------------------------------------------------------------
function TrialCallCard({
  trialCallAt,
  discordChannelUrl,
}: {
  trialCallAt: string;
  discordChannelUrl: string | null;
}) {
  const callMs = new Date(trialCallAt).getTime();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const msUntilCall = callMs - now;
  const minutesUntil = Math.floor(msUntilCall / 60_000);

  // Hide if call ended 2+ hours ago.
  if (msUntilCall < -2 * 60 * 60 * 1000) return null;

  // Within 15 minutes (or after start, before the 2hr cutoff): enable the
  // join button.
  const joinable = msUntilCall <= 15 * 60 * 1000;
  const callEnded = msUntilCall < 0;

  // Format the countdown human-readably.
  function fmt(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86_400);
    const hours = Math.floor((total % 86_400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  const callTimeLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(trialCallAt));

  return (
    <section className={styles.trialCallCard}>
      <div className={styles.trialCallEyebrow}>Free call with Tim</div>
      <div className={styles.trialCallTitle}>{callTimeLabel}</div>
      {!callEnded ? (
        <div className={styles.trialCallCountdown}>
          {joinable ? "Starts soon" : `In ${fmt(msUntilCall)}`}
        </div>
      ) : (
        <div className={styles.trialCallCountdown}>Call is live now</div>
      )}
      {joinable ? (
        <a
          href={discordChannelUrl ?? "https://xplkeyed.com"}
          target="_blank"
          rel="noreferrer noopener"
          className={styles.trialCallJoinBtn}
        >
          Join Discord call
        </a>
      ) : (
        <button
          type="button"
          disabled
          className={styles.trialCallJoinBtnDisabled}
        >
          Opens 15 min before
        </button>
      )}
      <p className={styles.trialCallNote}>
        The call happens on Discord, in the private channel Tim invited you to.
      </p>
    </section>
  );
}
