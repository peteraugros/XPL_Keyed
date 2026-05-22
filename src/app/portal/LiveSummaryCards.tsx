"use client";

// LiveSummaryCards
// ----------------
// The three lower summary cards on /portal (Next session, Trial prep /
// This cycle, Messages). Renders the same content the Server Component
// used to render directly, but:
//
//   1. Polls router.refresh() every 5 seconds when the tab is visible.
//      Re-runs the Server Component, which re-queries the DB, which
//      re-renders this Client Component with fresh props.
//   2. Detects which card's props changed since last render via a ref,
//      and adds a brief "just updated" highlight class + pill to the
//      affected card(s). Auto-clears after 3.5 seconds.
//
// Polling stops when document.hidden (tab in background) to save
// battery and bandwidth. Respects prefers-reduced-motion for the
// highlight animation.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type Phase = "trial" | "active" | "past_due" | "pending_cancel" | "ended";

type LatestMessage = {
  id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
} | null;

type Props = {
  phase: Phase;
  callDateTime: string | null;
  completedQuests: number;
  cycleProgress: number;
  cancelsUsed: number;
  latestMessage: LatestMessage;
  playerFirstName: string;
  playerDiscordUsername: string | null;
};

type Highlights = {
  sessions: boolean;
  progress: boolean;
  messages: boolean;
};

const NO_HIGHLIGHTS: Highlights = {
  sessions: false,
  progress: false,
  messages: false,
};

const POLL_INTERVAL_MS = 5000;
const HIGHLIGHT_DURATION_MS = 3500;

export default function LiveSummaryCards(props: Props) {
  const {
    phase,
    callDateTime,
    completedQuests,
    cycleProgress,
    cancelsUsed,
    latestMessage,
    playerFirstName,
    playerDiscordUsername,
  } = props;

  const router = useRouter();
  const [highlights, setHighlights] = useState<Highlights>(NO_HIGHLIGHTS);

  // Track previous values so we can diff and decide which card flashed.
  // Initialized from the first render's props, so the first effect run
  // sees prev == current and triggers no highlight.
  const prevRef = useRef({
    callDateTime,
    completedQuests,
    cycleProgress,
    cancelsUsed,
    latestMessageId: latestMessage?.id ?? null,
    phase,
  });

  // Detect prop changes and trigger highlights.
  useEffect(() => {
    const prev = prevRef.current;
    const changes: Highlights = {
      sessions:
        prev.callDateTime !== callDateTime ||
        prev.phase !== phase ||
        prev.cycleProgress !== cycleProgress,
      progress:
        prev.completedQuests !== completedQuests ||
        prev.cycleProgress !== cycleProgress ||
        prev.cancelsUsed !== cancelsUsed,
      messages: prev.latestMessageId !== (latestMessage?.id ?? null),
    };

    prevRef.current = {
      callDateTime,
      completedQuests,
      cycleProgress,
      cancelsUsed,
      latestMessageId: latestMessage?.id ?? null,
      phase,
    };

    if (changes.sessions || changes.progress || changes.messages) {
      setHighlights(changes);
      const timer = setTimeout(() => setHighlights(NO_HIGHLIGHTS), HIGHLIGHT_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [callDateTime, completedQuests, cycleProgress, cancelsUsed, latestMessage?.id, phase]);

  // Polling. Skip when tab is hidden to avoid waking the device every 5s.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  const showQuestSnapshot = phase === "trial";
  const showCycleSnapshot =
    phase === "active" || phase === "past_due" || phase === "pending_cancel";

  const cardClass = (highlighted: boolean) =>
    highlighted
      ? `${styles.summaryCard} ${styles.summaryCardJustUpdated}`
      : styles.summaryCard;

  return (
    <section className={styles.summaryGrid}>
      {/* Card 1: Next session */}
      <Link href={"/portal/sessions" as never} className={cardClass(highlights.sessions)}>
        {highlights.sessions ? <span className={styles.justUpdatedPill}>Just updated</span> : null}
        <div className={styles.summaryEyebrow}>Next session</div>
        <div className={styles.summaryTitle}>
          {phase === "active"
            ? "Sunday lesson drop"
            : phase === "past_due"
              ? "Paused"
              : phase === "pending_cancel"
                ? "No new sessions"
                : phase === "ended"
                  ? "Nothing scheduled"
                  : "Free intro call"}
        </div>
        <div className={styles.summaryBody}>
          {phase === "active"
            ? "Tim ships the slides and voiceover every Sunday. Your kid sees them in the player view."
            : phase === "past_due"
              ? "No Sunday drops or live calls run during the payment hold. Update your card to resume."
              : phase === "pending_cancel"
                ? "Nothing new ships during the 7 day undo window. Undo at any time to resume."
                : phase === "ended"
                  ? "No sessions on the books. Your past history is still here when you come back."
                  : callDateTime
                    ? `${callDateTime}. The call happens on Discord. Tim sends ${playerFirstName} an invite to ${playerDiscordUsername ?? "their Discord"} beforehand. No payment today.`
                    : "Check your Calendly confirmation for the date and time. The call happens on Discord."}
        </div>
        <div className={styles.summaryLink}>View sessions</div>
      </Link>

      {/* Card 2: Trial prep / This cycle / History */}
      <Link href={"/portal/progress" as never} className={cardClass(highlights.progress)}>
        {highlights.progress ? <span className={styles.justUpdatedPill}>Just updated</span> : null}
        <div className={styles.summaryEyebrow}>
          {showCycleSnapshot ? "This cycle" : showQuestSnapshot ? "Trial prep" : "History"}
        </div>
        <div className={styles.summaryTitle}>
          {showCycleSnapshot
            ? `Lesson ${cycleProgress} of 4`
            : showQuestSnapshot
              ? `${completedQuests} of 4 quests done`
              : "Saved for later"}
        </div>
        <div className={styles.summaryBody}>
          {phase === "active"
            ? cancelsUsed > 0
              ? `${cancelsUsed} cancellation${cancelsUsed === 1 ? "" : "s"} used this cycle. ${2 - cancelsUsed} remaining.`
              : "Both of your 2 cancellations this cycle are still available."
            : phase === "past_due"
              ? "Cycle is frozen at this lesson. It will resume from here once payment is updated."
              : phase === "pending_cancel"
                ? "Cycle paused while the undo window is open. Nothing advances until you decide."
                : phase === "ended"
                  ? "Everything from your past sessions stays accessible. Open progress to look back."
                  : `These are short prep tasks ${playerFirstName} does before the call. The more done, the better the first session goes.`}
        </div>
        <div className={styles.summaryLink}>View progress</div>
      </Link>

      {/* Card 3: Messages */}
      <Link href={"/portal/messages" as never} className={cardClass(highlights.messages)}>
        {highlights.messages ? <span className={styles.justUpdatedPill}>Just updated</span> : null}
        <div className={styles.summaryEyebrow}>Messages</div>
        <div className={styles.summaryTitle}>
          {latestMessage
            ? latestMessage.sender_role === "coach"
              ? "Tim sent a message"
              : `${playerFirstName} sent a message`
            : "Nothing yet"}
        </div>
        <div className={styles.summaryBody}>
          {latestMessage
            ? `"${latestMessage.body.slice(0, 90).trim()}${latestMessage.body.length > 90 ? "..." : ""}"`
            : `${playerFirstName} can message Tim from the player view. You see every message here.`}
        </div>
        <div className={styles.summaryLink}>Open messages</div>
      </Link>
    </section>
  );
}
