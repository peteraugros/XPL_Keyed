"use client";

// LiveSingleSessionCards
// ----------------------
// Replacement for LiveSummaryCards when the family bought a $24 single
// coaching session. Cycle framing (Lesson X of 4, Sunday drops,
// cancellations remaining) does not apply. Three cards instead:
//
//   1. Coaching session — date/time if scheduled, "Pick a time" prompt
//      if not. Links to /portal/sessions.
//   2. What we're working on — shows the parent's intake note plus the
//      lesson Tim picked (when he has). Links to /portal/progress.
//   3. Messages — same shape as the cycle card. Links to /portal/messages.
//
// Polls router.refresh() every 5 seconds when the tab is visible, same
// pattern as LiveSummaryCards.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type LatestMessage = {
  id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
} | null;

type Props = {
  callDateTime: string | null;
  callCompleted: boolean;
  intakeNote: string | null;
  lessonParentLabel: string | null;
  latestMessage: LatestMessage;
  playerFirstName: string;
};

type Highlights = {
  session: boolean;
  prep: boolean;
  messages: boolean;
};

const NO_HIGHLIGHTS: Highlights = {
  session: false,
  prep: false,
  messages: false,
};

const POLL_INTERVAL_MS = 5000;
const HIGHLIGHT_DURATION_MS = 3500;

export default function LiveSingleSessionCards(props: Props) {
  const {
    callDateTime,
    callCompleted,
    intakeNote,
    lessonParentLabel,
    latestMessage,
    playerFirstName,
  } = props;

  const router = useRouter();
  const [highlights, setHighlights] = useState<Highlights>(NO_HIGHLIGHTS);

  const prevRef = useRef({
    callDateTime,
    callCompleted,
    lessonParentLabel,
    latestMessageId: latestMessage?.id ?? null,
  });

  useEffect(() => {
    const prev = prevRef.current;
    const changes: Highlights = {
      session: prev.callDateTime !== callDateTime || prev.callCompleted !== callCompleted,
      prep: prev.lessonParentLabel !== lessonParentLabel,
      messages: prev.latestMessageId !== (latestMessage?.id ?? null),
    };
    prevRef.current = {
      callDateTime,
      callCompleted,
      lessonParentLabel,
      latestMessageId: latestMessage?.id ?? null,
    };
    if (changes.session || changes.prep || changes.messages) {
      setHighlights(changes);
      const timer = setTimeout(() => setHighlights(NO_HIGHLIGHTS), HIGHLIGHT_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [callDateTime, callCompleted, lessonParentLabel, latestMessage?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  const cardClass = (highlighted: boolean) =>
    highlighted
      ? `${styles.summaryCard} ${styles.summaryCardJustUpdated}`
      : styles.summaryCard;

  return (
    <section className={styles.summaryGrid}>
      {/* Card 1: Coaching session */}
      <Link href={"/portal/sessions" as never} className={cardClass(highlights.session)}>
        {highlights.session ? <span className={styles.justUpdatedPill}>Just updated</span> : null}
        <div className={styles.summaryEyebrow}>Coaching session</div>
        <div className={styles.summaryTitle}>
          {callCompleted
            ? "Session complete"
            : callDateTime
              ? "On the calendar"
              : "Pick a time"}
        </div>
        <div className={styles.summaryBody}>
          {callCompleted ? (
            <>
              Slides and voiceover land in the player view so {playerFirstName} can review.
            </>
          ) : callDateTime ? (
            <>
              <span className={styles.summaryMetaLine}>
                {callDateTime} &middot; 30 min &middot; Discord call.
              </span>
              <span className={styles.summarySubBody}>
                Tim sends {playerFirstName} the server invite beforehand.
              </span>
            </>
          ) : (
            <>
              Last step. Open the scheduling page and lock in the time that
              works for {playerFirstName}.
            </>
          )}
        </div>
        <div className={styles.summaryLink}>
          {callCompleted ? "View session" : callDateTime ? "Manage session" : "Pick a time"}
        </div>
      </Link>

      {/* Card 2: What we're working on */}
      <Link href={"/portal/progress" as never} className={cardClass(highlights.prep)}>
        {highlights.prep ? <span className={styles.justUpdatedPill}>Just updated</span> : null}
        <div className={styles.summaryEyebrow}>What we&apos;re working on</div>
        <div className={styles.summaryTitle}>
          {lessonParentLabel
            ? lessonParentLabel
            : "Tim is picking the lesson"}
        </div>
        <div className={styles.summaryBody}>
          {intakeNote ? (
            <>
              <span className={styles.summarySubBody}>
                You told Tim: &ldquo;{intakeNote.slice(0, 140).trim()}
                {intakeNote.length > 140 ? "..." : ""}&rdquo;
              </span>
              {lessonParentLabel ? null : (
                <span className={styles.summarySubBody}>
                  Tim builds the session around this. The lesson lands here
                  once he picks it.
                </span>
              )}
            </>
          ) : (
            <>
              Tim picks a lesson based on what you shared at signup. It
              shows up here when ready.
            </>
          )}
        </div>
        <div className={styles.summaryLink}>View details</div>
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
