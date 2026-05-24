"use client";

// /portal/sessions surface for $24 single-session families.
//
// Two states, both keyed off the single curriculum_slot's live_call_at:
//
//   * Unscheduled: Calendly embed (paid-lesson event type). The webhook
//     writes live_call_at + live_call_event_id when invitee.created
//     fires. After the postMessage we hard-reload so the flipped
//     lifecycle + slot row land cleanly.
//   * Scheduled (future): card showing date / time / 30 min / Discord.
//     "Need to reschedule?" points them at Tim. A proper in-portal
//     reschedule modal is Phase 2.5 polish; for now the Calendly
//     confirmation email already includes a reschedule link.
//
// No cycle anchor, no skip counter, no Repeat-at-this-time shortcut.
// Single-session is one-shot.

import Script from "next/script";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./sessions.module.css";

const PAID_LESSON_CALENDLY_URL =
  "https://calendly.com/xpl-keyed/paid-lesson";

function buildCalendlyEmbedUrl(
  parentName: string,
  parentEmail: string,
  kidFirstName: string,
  kidDiscord: string | null,
) {
  const params = new URLSearchParams({
    background_color: "0F1B47",
    text_color: "FFFFFF",
    primary_color: "C7FF3D",
    hide_gdpr_banner: "1",
    hide_event_type_details: "1",
    name: parentName,
    email: parentEmail,
    a1: kidFirstName,
  });
  if (kidDiscord) params.set("a2", kidDiscord);
  return `${PAID_LESSON_CALENDLY_URL}?${params.toString()}`;
}

import { formatCallDateTime } from "@/lib/datetime";

function formatSlotDateTime(iso: string): string {
  return formatCallDateTime(iso) ?? "";
}

export default function SingleSessionScheduler({
  parentFirstName,
  parentEmail,
  kidFirstName,
  kidDiscord,
  scheduledAt,
  completed,
  intakeNote,
}: {
  parentFirstName: string;
  parentEmail: string;
  kidFirstName: string;
  kidDiscord: string | null;
  scheduledAt: string | null;
  completed: boolean;
  intakeNote: string | null;
}) {
  const [justBooked, setJustBooked] = useState(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { event?: string } | undefined;
      if (!data?.event) return;
      if (data.event === "calendly.event_scheduled") {
        setJustBooked(true);
        window.setTimeout(() => window.location.reload(), 1500);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Scheduled state — date already on the books, future or past.
  if (scheduledAt) {
    const dt = formatSlotDateTime(scheduledAt);
    const isPast = new Date(scheduledAt).getTime() < Date.now();
    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>
          {completed ? "Session complete" : isPast ? "Session was" : "Session set"}
        </div>
        <h2 className={styles.cardTitle}>
          {completed
            ? `${kidFirstName}'s session is wrapped`
            : `${kidFirstName}'s coaching session`}
        </h2>
        <div className={styles.metaRow}>
          <div className={styles.metaBlock}>
            <span className={styles.metaLabel}>When</span>
            <span className={styles.metaValue}>{dt}</span>
          </div>
          <div className={styles.metaBlock}>
            <span className={styles.metaLabel}>Length</span>
            <span className={styles.metaValue}>30 min</span>
          </div>
          <div className={styles.metaBlock}>
            <span className={styles.metaLabel}>Where</span>
            <span className={styles.metaValue}>Discord</span>
          </div>
        </div>
        {completed ? (
          <p className={styles.body}>
            Tim&apos;s wrapped the call. Slides, voiceover, and his note land
            in the player view for {kidFirstName} to review.
          </p>
        ) : isPast ? (
          <p className={styles.body}>
            Tim&apos;s wrapping up the session details. The lesson materials
            and his note land in the player view shortly.
          </p>
        ) : (
          <>
            <p className={styles.body}>
              Tim sends {kidFirstName} the XPL Keyed Discord server invite
              before the call. After the session, the slides and voiceover
              land in the player view so {kidFirstName} can review.
            </p>
            <p className={styles.subtle}>
              Need to reschedule? Use the link in your Calendly confirmation
              email, or message Tim from the dashboard.
            </p>
          </>
        )}
        <Link href={"/portal" as never} className={styles.linkBtn}>
          Back to overview
        </Link>
      </section>
    );
  }

  // Unscheduled state — Calendly embed.
  return (
    <section className={styles.card}>
      <div className={styles.cardEyebrow}>Last step</div>
      <h2 className={styles.cardTitle}>
        Pick the time for {kidFirstName}&apos;s coaching call
      </h2>
      <p className={styles.body}>
        30 minutes on Discord. Tim sends the server invite before the call
        starts.
      </p>
      {intakeNote ? (
        <div className={styles.calloutSoft}>
          <span className={styles.calloutEyebrow}>You told Tim</span>
          <span className={styles.calloutBody}>
            &ldquo;{intakeNote.slice(0, 220).trim()}
            {intakeNote.length > 220 ? "..." : ""}&rdquo;
          </span>
        </div>
      ) : null}

      {justBooked ? (
        <div className={styles.justBookedCard}>
          <div className={styles.justBookedTitle}>Got it. Loading your session details...</div>
          <p className={styles.subtle}>
            If this hangs for more than a few seconds, tap below to continue.
          </p>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => window.location.reload()}
          >
            Continue
          </button>
        </div>
      ) : (
        <div className={styles.calendlyFrame}>
          <div
            className="calendly-inline-widget"
            data-url={buildCalendlyEmbedUrl(
              parentFirstName,
              parentEmail,
              kidFirstName,
              kidDiscord,
            )}
            style={{ minWidth: "100%", height: "700px" }}
          />
          <Script
            src="https://assets.calendly.com/assets/external/widget.js"
            strategy="afterInteractive"
          />
        </div>
      )}
    </section>
  );
}
