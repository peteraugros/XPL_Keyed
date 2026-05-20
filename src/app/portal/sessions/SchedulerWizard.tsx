"use client";

// The 4-of-4 booking wizard. Strict weekly sequencing: only the next
// pending slot has an active Calendly embed; future slots are visible
// but locked.
//
// Calendly's invitee.created webhook writes the booking back to
// curriculum_slots. On success the page calls router.refresh() to pick
// up the new slot row and advance the wizard.
//
// Prefill: parent name + email (page passes them in from the session).
// Custom questions (a1, a2) are not used here — the kid's identity is
// known to the platform; Calendly just needs to schedule.

import Script from "next/script";
import { useEffect, useState } from "react";
import styles from "./sessions.module.css";

type Slot = {
  id: string;
  week_number: number;
  is_vod_review: boolean;
  live_call_at: string | null;
  live_call_event_id: string | null;
  fortnite_label: string | null;
  parent_label: string | null;
  parent_skill_description: string | null;
};

// Hardcoded for now. When Peter sets up the "Paid lesson 30 min" event
// type in Calendly, the slug should land here (or move to an env var).
const PAID_LESSON_CALENDLY_URL =
  "https://calendly.com/xpl-keyed/paid-lesson";

function buildCalendlyEmbedUrl(
  parentName: string,
  parentEmail: string,
  kidFirstName: string,
  kidDiscord: string | null,
  preNavigateToIso: string | null,
) {
  // Calendly URL prefill params:
  //   name, email -> the top-level invitee fields
  //   a1, a2      -> the two custom questions, 1-indexed by position
  //   month       -> navigate the date picker to a specific month
  //   date        -> highlight a specific day (newer Calendly param)
  // Prefilling all four means the parent never has to retype on
  // subsequent bookings. month + date pre-navigate the embed to the
  // matching slot when "Repeat at this time" mode is active.
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
  if (preNavigateToIso) {
    const d = new Date(preNavigateToIso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    params.set("month", `${yyyy}-${mm}`);
    params.set("date", `${yyyy}-${mm}-${dd}`);
  }
  return `${PAID_LESSON_CALENDLY_URL}?${params.toString()}`;
}

function formatSuggestedSlot(iso: string): string {
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

function formatSlotDateTime(iso: string): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
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

export default function SchedulerWizard({
  parentFirstName,
  kidFirstName,
  kidDiscord,
  parentEmail,
  curriculumId,
  slots,
  cycleAnchorAt,
  suggestedDateTime,
}: {
  parentFirstName: string;
  kidFirstName: string;
  kidDiscord: string | null;
  parentEmail: string;
  curriculumId: string;
  slots: Slot[];
  cycleAnchorAt: string | null;
  suggestedDateTime: string | null;
}) {
  // Booked slots count. The next pending slot is the lowest week_number
  // with live_call_at IS NULL.
  const bookedCount = slots.filter((s) => s.live_call_at).length;
  const totalSlots = slots.length || 4;
  const nextPending = slots.find((s) => !s.live_call_at) ?? null;
  const stepLabel = `Step ${Math.min(bookedCount + 1, totalSlots)} of ${totalSlots}`;
  const isComplete = bookedCount >= totalSlots;

  // Listen for Calendly's postMessage. invitee.created means a booking
  // landed; the webhook will write the slot. We need a FULL page reload
  // (not router.refresh) for two reasons:
  //   1. Calendly's widget.js initializes the embed at load time and
  //      doesn't re-init on React re-renders — the iframe stays stuck
  //      on the "you are scheduled" success page.
  //   2. The post-booking server state (lifecycle + slot row) needs
  //      to be picked up cleanly.
  // The reload also gives the Calendly webhook ~1.5s to land in our
  // DB before the new page renders.
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

  // Auto-book modal state. Shows the 3 remaining computed datetimes and
  // a confirm button. On confirm, POSTs /api/portal/sessions/auto-book
  // which writes the slots directly + flips lifecycle to PENDING_PAYMENT.
  // Page reload after success lands on the PaymentSummary surface.
  const [autoBookOpen, setAutoBookOpen] = useState(false);
  const [autoBooking, setAutoBooking] = useState(false);
  const [autoBookError, setAutoBookError] = useState<string | null>(null);

  // The list of remaining-week datetimes for the confirmation modal.
  const remainingSlots = slots.filter((s) => !s.live_call_at);
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const remainingProjections = cycleAnchorAt
    ? remainingSlots.map((s) => ({
        week_number: s.week_number,
        iso: new Date(
          new Date(cycleAnchorAt).getTime() + (s.week_number - 1) * oneWeekMs,
        ).toISOString(),
      }))
    : [];

  async function confirmAutoBook() {
    setAutoBookError(null);
    setAutoBooking(true);
    try {
      const res = await fetch("/api/portal/sessions/auto-book", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setAutoBookError(body.error ?? "Auto-book failed. Try again.");
        setAutoBooking(false);
        return;
      }
      window.location.reload();
    } catch {
      setAutoBookError("Could not reach the server.");
      setAutoBooking(false);
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardEyebrow}>{stepLabel}</div>
      <h2 className={styles.cardTitle}>
        Reserve your first {totalSlots} weekly coaching sessions
      </h2>
      <p className={styles.body}>
        Pick one slot per week, in order. {kidFirstName} joins on Discord at
        the time you book.
      </p>

      {/* Auto-book shortcut appears ABOVE the Calendly embed so the
          parent sees the one-click option before scrolling. Only
          visible after Week 1 anchors the cycle and there's more than
          one week remaining to book. */}
      {!isComplete &&
      !justBooked &&
      suggestedDateTime &&
      cycleAnchorAt &&
      remainingProjections.length > 1 ? (
        <div className={styles.autoBookCallout}>
          <div className={styles.autoBookEyebrow}>Shortcut</div>
          <div className={styles.autoBookTitle}>
            Want to use {formatSuggestedSlot(remainingProjections[0]?.iso ?? suggestedDateTime).split(" at ")[1]} for the rest?
          </div>
          <p className={styles.autoBookBody}>
            Auto-book Week{remainingProjections.length === 1 ? "" : "s"}{" "}
            {remainingProjections.map((p) => p.week_number).join(", ")} at the
            same time as your first session. One tap, no calendar picking.
          </p>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setAutoBookOpen(true)}
          >
            Auto-book remaining
          </button>
        </div>
      ) : null}

      {/* Calendly embed (default per-week booking flow). */}
      {!isComplete && nextPending ? (
        justBooked ? (
          <div className={styles.justBookedCard}>
            <div className={styles.justBookedTitle}>Got it. Loading the next week...</div>
            <p className={styles.subtle}>
              If this hangs for more than a few seconds, tap the button
              below to continue.
            </p>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => window.location.reload()}
            >
              Continue to next week
            </button>
          </div>
        ) : (
          <>
            <div className={styles.calendlyFrame}>
              <div
                className="calendly-inline-widget"
                data-url={buildCalendlyEmbedUrl(
                  parentFirstName,
                  parentEmail,
                  kidFirstName,
                  kidDiscord,
                  null,
                )}
                style={{ minWidth: "100%", height: "700px" }}
              />
              <Script
                src="https://assets.calendly.com/assets/external/widget.js"
                strategy="afterInteractive"
              />
            </div>
            <p className={styles.subtle}>
              After you book, this page reloads and steps to Week{" "}
              {Math.min((nextPending.week_number ?? 0) + 1, totalSlots)}.
            </p>
          </>
        )
      ) : null}

      {/* Auto-book confirmation modal. Shows the 3 datetimes the parent
          is about to lock in. */}
      {autoBookOpen ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modalCard}>
            <div className={styles.modalEyebrow}>Confirm</div>
            <h3 className={styles.modalTitle}>
              Book {remainingProjections.length} session
              {remainingProjections.length === 1 ? "" : "s"} at this time?
            </h3>
            <ul className={styles.modalList}>
              {remainingProjections.map((p) => (
                <li key={p.week_number} className={styles.modalListItem}>
                  <span className={styles.modalWeek}>Week {p.week_number}</span>
                  <span>{formatSuggestedSlot(p.iso)}</span>
                </li>
              ))}
            </ul>
            <p className={styles.subtle}>
              These dates land in your dashboard immediately and Tim will see
              them. After you confirm, you'll go straight to checkout.
            </p>
            {autoBookError ? (
              <div className={styles.alert}>{autoBookError}</div>
            ) : null}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => {
                  setAutoBookOpen(false);
                  setAutoBookError(null);
                }}
                disabled={autoBooking}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={confirmAutoBook}
                disabled={autoBooking}
              >
                {autoBooking ? "Booking..." : "Yes, auto-book"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reserved sessions list. Sits below the scheduler as a status
          summary — the parent sees at a glance which weeks are booked
          and which are pending. */}
      <ul className={styles.weekList}>
        {slots.map((s) => {
          const isBooked = !!s.live_call_at;
          const isCurrent = !isBooked && s.id === nextPending?.id;
          const lessonLabel = s.is_vod_review
            ? "VOD review"
            : s.parent_label ?? "Lesson";
          return (
            <li
              key={s.id}
              className={`${styles.weekRow} ${
                isBooked
                  ? styles.weekRowDone
                  : isCurrent
                    ? styles.weekRowCurrent
                    : styles.weekRowLocked
              }`}
            >
              <span className={styles.weekNum}>Week {s.week_number}</span>
              <span className={styles.weekCopy}>
                <span className={styles.weekLabel}>{lessonLabel}</span>
                <span className={styles.weekTime}>
                  {isBooked
                    ? formatSlotDateTime(s.live_call_at!)
                    : isCurrent
                      ? "Booking now"
                      : "Locked"}
                </span>
              </span>
              <span
                className={`${styles.weekStatus} ${
                  isBooked ? styles.weekStatusDone : ""
                }`}
              >
                {isBooked ? "Reserved" : isCurrent ? "Next" : "Locked"}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Cycle anchor hint (when set), helps the parent see the cadence. */}
      {cycleAnchorAt && bookedCount > 0 && bookedCount < totalSlots ? (
        <p className={styles.subtle}>
          Your cycle started{" "}
          {new Intl.DateTimeFormat("en-US", {
            month: "long",
            day: "numeric",
          }).format(new Date(cycleAnchorAt))}
          . Stay roughly weekly for the smoothest progression.
        </p>
      ) : null}
    </section>
  );
}
