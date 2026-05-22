"use client";

// LiveOnboardingCards
// -------------------
// Renders in place of LiveSummaryCards when the parent is in a
// post-acceptance lifecycle state (ACCEPTED_PENDING_SCHEDULING,
// SCHEDULING_IN_PROGRESS, PENDING_PAYMENT). Three cards focused on
// onboarding rather than ongoing operations:
//
//   1. Next session       — week + date/time/duration of next slot
//   2. Progress overview  — "X of 4 lessons booked" + lifecycle nudge
//   3. Quick actions      — contextual CTA stack (schedule / pay,
//                            message tutor, view plan)
//
// Same polling + change-highlight pattern as LiveSummaryCards. Polls
// router.refresh() every 5 seconds when the tab is visible. Detects
// prop changes since last render via a ref; flashes a lime tint +
// "Just updated" pill on the affected card(s) for ~3.5s.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type SlotMeta = { week_number: number; live_call_at: string | null };

type Props = {
  lifecycleState: string | null;
  nextSlot: SlotMeta | null;
  slotsBookedCount: number;
  totalSlots: number;
  approvalToken: string;
  playerFirstName: string;
};

type Highlights = {
  nextSession: boolean;
  progress: boolean;
  actions: boolean;
};

const NO_HIGHLIGHTS: Highlights = {
  nextSession: false,
  progress: false,
  actions: false,
};

const POLL_INTERVAL_MS = 5000;
const HIGHLIGHT_DURATION_MS = 3500;

// Compact "Mon, May 27 at 4:00 pm" formatter. Mirrors the paid session
// cards on /portal/sessions so the visual treatment carries across.
function formatSlotDateTime(iso: string): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  const timeRaw = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  const time = timeRaw.replace(" AM", " am").replace(" PM", " pm");
  return `${datePart} at ${time}`;
}

export default function LiveOnboardingCards(props: Props) {
  const {
    lifecycleState,
    nextSlot,
    slotsBookedCount,
    totalSlots,
    approvalToken,
    playerFirstName,
  } = props;

  const router = useRouter();
  const [highlights, setHighlights] = useState<Highlights>(NO_HIGHLIGHTS);

  // Diffed fields per card. Polling refreshes the Server Component,
  // which feeds new props down; the diff catches what changed.
  const prevRef = useRef({
    nextSlotKey: nextSlot
      ? `${nextSlot.week_number}|${nextSlot.live_call_at ?? "none"}`
      : "none",
    slotsBookedCount,
    lifecycleState,
  });

  useEffect(() => {
    const prev = prevRef.current;
    const nextSlotKey = nextSlot
      ? `${nextSlot.week_number}|${nextSlot.live_call_at ?? "none"}`
      : "none";

    const changes: Highlights = {
      nextSession: prev.nextSlotKey !== nextSlotKey,
      progress: prev.slotsBookedCount !== slotsBookedCount,
      actions: prev.lifecycleState !== lifecycleState,
    };

    prevRef.current = { nextSlotKey, slotsBookedCount, lifecycleState };

    if (changes.nextSession || changes.progress || changes.actions) {
      setHighlights(changes);
      const timer = setTimeout(() => setHighlights(NO_HIGHLIGHTS), HIGHLIGHT_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [nextSlot, slotsBookedCount, lifecycleState]);

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

  // ----- Card 1: Next session content -------------------------------
  const nextSessionEyebrow = "Next session";
  let nextSessionTitle: string;
  let nextSessionBody: React.ReactNode;
  if (!nextSlot) {
    nextSessionTitle = "Curriculum loading";
    nextSessionBody = (
      <span className={styles.summarySubBody}>
        Tim is finishing your 4 week plan. Refresh in a few seconds.
      </span>
    );
  } else if (!nextSlot.live_call_at) {
    nextSessionTitle = `Week ${nextSlot.week_number}`;
    nextSessionBody = (
      <>
        <span className={styles.summaryMetaLine}>Not yet booked.</span>
        <span className={styles.summarySubBody}>
          Open Sessions and pick a time. Tim is your tutor; the call
          happens on Discord.
        </span>
      </>
    );
  } else {
    nextSessionTitle = `Week ${nextSlot.week_number}`;
    nextSessionBody = (
      <>
        <span className={styles.summaryMetaLine}>
          {formatSlotDateTime(nextSlot.live_call_at)} &middot; 30 min &middot;
          Discord call.
        </span>
        <span className={styles.summarySubBody}>
          Tutor: Tim. Status: Booked.
        </span>
      </>
    );
  }

  // ----- Card 2: Progress content -----------------------------------
  const progressEyebrow = "Onboarding";
  let progressTitle: string;
  let progressBody: string;
  if (lifecycleState === "PENDING_PAYMENT") {
    progressTitle = "All 4 lessons booked";
    progressBody = `${playerFirstName}'s slots are reserved. Complete payment to lock them in. Card details are entered on the Sessions page.`;
  } else if (slotsBookedCount === 0) {
    progressTitle = `0 of ${totalSlots} lessons booked`;
    progressBody = `Pick times that work for your family. ${playerFirstName}'s lessons run in the order you book them, one per week.`;
  } else if (slotsBookedCount < totalSlots) {
    progressTitle = `${slotsBookedCount} of ${totalSlots} lessons booked`;
    progressBody = `${totalSlots - slotsBookedCount} more to go. Finish booking to move to payment.`;
  } else {
    progressTitle = `All ${totalSlots} lessons booked`;
    progressBody = `Final step: confirm payment from the Sessions page.`;
  }

  // ----- Card 3: Quick actions content ------------------------------
  const isPendingPayment = lifecycleState === "PENDING_PAYMENT";
  const primaryActionLabel = isPendingPayment
    ? "Complete payment"
    : slotsBookedCount === 0
      ? "Schedule sessions"
      : "Continue scheduling";

  return (
    <section className={styles.summaryGrid}>
      {/* Card 1: Next session */}
      <Link
        href={"/portal/sessions" as never}
        className={cardClass(highlights.nextSession)}
      >
        {highlights.nextSession ? (
          <span className={styles.justUpdatedPill}>Just updated</span>
        ) : null}
        <div className={styles.summaryEyebrow}>{nextSessionEyebrow}</div>
        <div className={styles.summaryTitle}>{nextSessionTitle}</div>
        <div className={styles.summaryBody}>{nextSessionBody}</div>
        <div className={styles.summaryLink}>View sessions</div>
      </Link>

      {/* Card 2: Progress overview */}
      <Link
        href={"/portal/progress" as never}
        className={cardClass(highlights.progress)}
      >
        {highlights.progress ? (
          <span className={styles.justUpdatedPill}>Just updated</span>
        ) : null}
        <div className={styles.summaryEyebrow}>{progressEyebrow}</div>
        <div className={styles.summaryTitle}>{progressTitle}</div>
        <div className={styles.summaryBody}>{progressBody}</div>
        <div className={styles.summaryLink}>View progress</div>
      </Link>

      {/* Card 3: Quick actions. Not a single-target Link card — renders
          a stack of three contextual actions inside the same visual
          shell. The whole card has no outer href; each action is its
          own link. */}
      <div className={cardClass(highlights.actions)} aria-label="Quick actions">
        {highlights.actions ? (
          <span className={styles.justUpdatedPill}>Just updated</span>
        ) : null}
        <div className={styles.summaryEyebrow}>Quick actions</div>
        <div className={styles.summaryTitle}>What you can do now</div>
        <div className={styles.quickActionsList}>
          <Link
            href={"/portal/sessions" as never}
            className={styles.quickActionPrimary}
          >
            {primaryActionLabel}
          </Link>
          <Link
            href={"/portal/messages" as never}
            className={styles.quickActionSecondary}
          >
            Message Tim
          </Link>
          <Link
            href={`/curriculum/${approvalToken}` as never}
            className={styles.quickActionSecondary}
          >
            View 4 week plan
          </Link>
        </div>
      </div>
    </section>
  );
}
