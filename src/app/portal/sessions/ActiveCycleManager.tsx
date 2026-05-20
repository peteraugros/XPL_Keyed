"use client";

// Active-cycle session list + reschedule modal.
//
// Per /Users/peteraugros/Desktop/xpl-reschedule-spec.md:
//   * One "Reschedule" button per booked session line.
//   * Modal branches on the 24hr boundary:
//       State A (>=24hr): Calendly embed picker. Confirm fires
//         /api/portal/sessions/:slot_id/reschedule. Free if delta is
//         within 7 days; otherwise consumes a skip.
//       State B (<24hr): "Cancel the live call" confirm only. Counts
//         as a skip; kid keeps the materials.
//   * Counter strip above the list. 3/3 = auto renew off, cycle still
//     completes to lesson 4.

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

type CalendlyMessage = {
  origin?: string;
  data?: { event?: string; payload?: { event?: { uri?: string } } };
};

const PAID_LESSON_CALENDLY_URL =
  "https://calendly.com/xpl-keyed/paid-lesson";

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

function buildCalendlyEmbedUrl(
  parentName: string,
  parentEmail: string,
  kidFirstName: string,
  kidDiscord: string | null,
  originalIso: string,
): string {
  // Pre-navigate the embed to the same week as the original time so
  // the parent's first reflex is "pick a time within 7 days." Calendly
  // ignores month/date that fall in the past, so this is safe.
  const d = new Date(originalIso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const params = new URLSearchParams({
    background_color: "0F1B47",
    text_color: "FFFFFF",
    primary_color: "C7FF3D",
    hide_gdpr_banner: "1",
    hide_event_type_details: "1",
    name: parentName,
    email: parentEmail,
    a1: kidFirstName,
    month: `${yyyy}-${mm}`,
    date: `${yyyy}-${mm}-${dd}`,
  });
  if (kidDiscord) params.set("a2", kidDiscord);
  return `${PAID_LESSON_CALENDLY_URL}?${params.toString()}`;
}

export default function ActiveCycleManager({
  parentFirstName,
  parentEmail,
  kidFirstName,
  kidDiscord,
  slots,
  skipsUsed,
  autoRenewEnabled,
}: {
  parentFirstName: string;
  parentEmail: string;
  kidFirstName: string;
  kidDiscord: string | null;
  slots: Slot[];
  skipsUsed: number;
  autoRenewEnabled: boolean;
}) {
  const router = useRouter();
  const [openSlot, setOpenSlot] = useState<Slot | null>(null);

  return (
    <>
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Active cycle</div>
        <h2 className={styles.cardTitle}>Your booked sessions</h2>
        <SkipCounter skipsUsed={skipsUsed} autoRenewEnabled={autoRenewEnabled} />
        <ul className={styles.weekList}>
          {slots.map((s) => (
            <li key={s.id} className={styles.weekRow}>
              <span className={styles.weekNum}>Week {s.week_number}</span>
              <span className={styles.weekCopy}>
                <span className={styles.weekLabel}>
                  {s.fortnite_label ?? (s.is_vod_review ? "VOD review" : "Lesson")}
                </span>
                <span className={styles.weekTime}>
                  {s.live_call_at
                    ? formatSlotDateTime(s.live_call_at)
                    : "(no time yet)"}
                </span>
              </span>
              {s.live_call_at && !isPast(s.live_call_at) ? (
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setOpenSlot(s)}
                >
                  Reschedule
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {openSlot && openSlot.live_call_at ? (
        <RescheduleModal
          slot={openSlot}
          parentFirstName={parentFirstName}
          parentEmail={parentEmail}
          kidFirstName={kidFirstName}
          kidDiscord={kidDiscord}
          skipsUsed={skipsUsed}
          onClose={() => setOpenSlot(null)}
          onDone={() => {
            setOpenSlot(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function SkipCounter({
  skipsUsed,
  autoRenewEnabled,
}: {
  skipsUsed: number;
  autoRenewEnabled: boolean;
}) {
  if (!autoRenewEnabled) {
    return (
      <div className={styles.skipCounterOff}>
        Skips: 3 of 3 used. Auto renew is off for the next cycle. This cycle still finishes through lesson 4.
      </div>
    );
  }
  return (
    <div className={styles.skipCounter}>
      Skips: {skipsUsed} of 3 used this cycle.{" "}
      <span className={styles.skipCounterHint}>
        3 skips turns off auto renew.
      </span>
    </div>
  );
}

// --- Modal -----------------------------------------------------------------

function RescheduleModal({
  slot,
  parentFirstName,
  parentEmail,
  kidFirstName,
  kidDiscord,
  skipsUsed,
  onClose,
  onDone,
}: {
  slot: Slot;
  parentFirstName: string;
  parentEmail: string;
  kidFirstName: string;
  kidDiscord: string | null;
  skipsUsed: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const liveCallAt = slot.live_call_at!;
  const hoursUntilCall = useMemo(
    () => (new Date(liveCallAt).getTime() - Date.now()) / (1000 * 60 * 60),
    [liveCallAt],
  );
  const withinDay = hoursUntilCall < 24;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        {withinDay ? (
          <WithinDayState
            slot={slot}
            kidFirstName={kidFirstName}
            skipsUsed={skipsUsed}
            onDone={onDone}
          />
        ) : (
          <OutsideDayState
            slot={slot}
            parentFirstName={parentFirstName}
            parentEmail={parentEmail}
            kidFirstName={kidFirstName}
            kidDiscord={kidDiscord}
            skipsUsed={skipsUsed}
            onDone={onDone}
          />
        )}
      </div>
    </div>
  );
}

// --- State B: within 24 hours ----------------------------------------------

function WithinDayState({
  slot,
  kidFirstName,
  skipsUsed,
  onDone,
}: {
  slot: Slot;
  kidFirstName: string;
  skipsUsed: number;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wouldBe = skipsUsed + 1;
  const wouldHitCap = wouldBe >= 3;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/sessions/${slot.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "Could not cancel. Try again.");
        setSubmitting(false);
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className={styles.modalEyebrow}>Less than 24 hours away</div>
      <h2 className={styles.modalTitle}>Cancel Week {slot.week_number}'s live call</h2>
      <p className={styles.modalBody}>
        It's less than 24 hours before this call, so it can't be moved.{" "}
        {kidFirstName} still gets the slides and voiceover for the week. Only
        the live call is lost.
      </p>
      <p className={styles.modalPolicy}>
        This counts as 1 skip ({wouldBe} of 3 used this cycle).{" "}
        {wouldHitCap
          ? "This will turn off auto renew. Your current cycle continues through lesson 4, then ends."
          : "3 skips turns off auto renew."}
      </p>
      {error ? <p className={styles.modalError}>{error}</p> : null}
      <div className={styles.modalRow}>
        <button
          type="button"
          className={styles.modalCta}
          onClick={submit}
          disabled={submitting}
        >
          {submitting
            ? "Cancelling..."
            : wouldHitCap
              ? "Cancel and end auto renew"
              : "Cancel the live call"}
        </button>
        <button
          type="button"
          className={styles.modalSecondary}
          onClick={onDone}
          disabled={submitting}
        >
          Keep the call
        </button>
      </div>
    </>
  );
}

// --- State A: outside 24 hours, Calendly embed picker ----------------------

function OutsideDayState({
  slot,
  parentFirstName,
  parentEmail,
  kidFirstName,
  kidDiscord,
  skipsUsed,
  onDone,
}: {
  slot: Slot;
  parentFirstName: string;
  parentEmail: string;
  kidFirstName: string;
  kidDiscord: string | null;
  skipsUsed: number;
  onDone: () => void;
}) {
  const originalIso = slot.live_call_at!;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    free: boolean;
    skips_used: number;
    auto_renew_enabled: boolean;
    new_time: string;
  } | null>(null);
  const embedUrl = useMemo(
    () =>
      buildCalendlyEmbedUrl(
        parentFirstName,
        parentEmail,
        kidFirstName,
        kidDiscord,
        originalIso,
      ),
    [parentFirstName, parentEmail, kidFirstName, kidDiscord, originalIso],
  );

  // Listen for calendly.event_scheduled. Calendly emits the event URI on
  // the payload; we capture it + post to our reschedule endpoint, which
  // cancels the old event and updates the slot. We also need the new
  // time, which Calendly doesn't ship in the postMessage payload — we
  // fetch it via the API in a follow-up step (or rely on the embed's
  // own info).
  //
  // Practical workaround: Calendly's event_scheduled payload includes
  // the event URI. Our backend can fetch /scheduled_events/<uuid> via
  // the PAT to get the start_time. Doing that on the server keeps the
  // PAT off the client.
  useEffect(() => {
    function onMessage(e: MessageEvent<CalendlyMessage["data"]>) {
      const origin = (e as MessageEvent).origin;
      if (!origin || !origin.includes("calendly.com")) return;
      const data = e.data;
      if (!data || data.event !== "calendly.event_scheduled") return;
      const eventUri = data.payload?.event?.uri;
      if (!eventUri) return;
      commit(eventUri);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.id]);

  async function commit(newEventUri: string) {
    setError(null);
    setSubmitting(true);
    try {
      // Resolve the new time via our backend (fetches /scheduled_events
      // server-side using the PAT, returns start_time).
      const resolved = await fetch(
        `/api/portal/sessions/resolve-event?uri=${encodeURIComponent(newEventUri)}`,
      );
      if (!resolved.ok) {
        setError("Could not look up the new time. Refresh and try again.");
        setSubmitting(false);
        return;
      }
      const { start_time } = (await resolved.json()) as { start_time: string };

      const res = await fetch(`/api/portal/sessions/${slot.id}/reschedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          new_event_uri: newEventUri,
          new_time_iso: start_time,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "Could not commit the reschedule. Try again.");
        setSubmitting(false);
        return;
      }
      const body = (await res.json()) as {
        free: boolean;
        skips_used: number;
        auto_renew_enabled: boolean;
      };
      setResult({
        free: body.free,
        skips_used: body.skips_used,
        auto_renew_enabled: body.auto_renew_enabled,
        new_time: start_time,
      });
      setSubmitting(false);
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <>
        <div className={styles.modalEyebrow}>Done</div>
        <h2 className={styles.modalTitle}>
          Week {slot.week_number} moved to {formatSlotDateTime(result.new_time)}
        </h2>
        <p className={styles.modalBody}>
          {result.free
            ? "Free reschedule. Your skip counter didn't change."
            : `This counts as 1 skip (${result.skips_used} of 3 used this cycle).`}
          {!result.auto_renew_enabled
            ? " Auto renew is off for the next cycle. The current cycle continues through lesson 4."
            : ""}
        </p>
        <div className={styles.modalRow}>
          <button type="button" className={styles.modalCta} onClick={onDone}>
            Done
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Script src="https://assets.calendly.com/assets/external/widget.js" strategy="afterInteractive" />
      <div className={styles.modalEyebrow}>Reschedule Week {slot.week_number}</div>
      <h2 className={styles.modalTitle}>Pick a new time</h2>
      <p className={styles.modalBody}>
        Currently scheduled for {formatSlotDateTime(originalIso)}.
      </p>
      <p className={styles.modalPolicy}>
        Picks within 7 days of your original time are free. Picks further out
        push the cycle forward and count as 1 skip. You have {3 - skipsUsed}{" "}
        skips left this cycle.
      </p>
      {error ? <p className={styles.modalError}>{error}</p> : null}
      {submitting ? (
        <p className={styles.modalBody}>Committing your new time...</p>
      ) : null}
      <div
        className="calendly-inline-widget"
        data-url={embedUrl}
        style={{ minWidth: "280px", height: "700px" }}
      />
    </>
  );
}
