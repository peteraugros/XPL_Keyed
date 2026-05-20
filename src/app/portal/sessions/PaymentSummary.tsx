"use client";

// PENDING_PAYMENT sub-state on /portal/sessions. All 4 slots are booked.
// Renders the reserved sessions + a single "Complete checkout" button
// that hits the existing /api/curriculum/[token]/checkout endpoint via
// a slim wrapper that resolves the active curriculum's approval_token
// server-side.

import { useState } from "react";
import styles from "./sessions.module.css";

type Slot = {
  id: string;
  week_number: number;
  live_call_at: string | null;
  fortnite_label: string | null;
  parent_label: string | null;
  is_vod_review: boolean;
};

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

export default function PaymentSummary({
  kidFirstName,
  slots,
  curriculumId,
}: {
  kidFirstName: string;
  slots: Slot[];
  curriculumId: string;
  subscriptionId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCheckout() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/sessions/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ curriculum_id: curriculumId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not start checkout. Try again.");
        setBusy(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Could not reach the server. Try again.");
      setBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardEyebrow}>Last step</div>
      <h2 className={styles.cardTitle}>
        Confirm and pay for {kidFirstName}&apos;s first cycle
      </h2>
      <p className={styles.body}>
        All four sessions are reserved. Approve the $56 first-cycle charge
        to lock everything in. Future cycles bill automatically every four
        delivered lessons; no extra clicks needed.
      </p>

      <ul className={styles.weekList}>
        {slots.map((s) => (
          <li key={s.id} className={`${styles.weekRow} ${styles.weekRowDone}`}>
            <span className={styles.weekNum}>Week {s.week_number}</span>
            <span className={styles.weekCopy}>
              <span className={styles.weekLabel}>
                {s.is_vod_review ? "VOD review" : s.parent_label ?? "Lesson"}
              </span>
              <span className={styles.weekTime}>
                {s.live_call_at ? formatSlotDateTime(s.live_call_at) : "(no time)"}
              </span>
            </span>
            <span className={`${styles.weekStatus} ${styles.weekStatusDone}`}>
              Reserved
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.paymentRow}>
        <div className={styles.paymentAmount}>$56</div>
        <button
          type="button"
          onClick={onCheckout}
          disabled={busy}
          className={styles.primaryBtn}
        >
          {busy ? "Opening checkout..." : "Complete checkout"}
        </button>
      </div>
      {error ? <div className={styles.alert}>{error}</div> : null}

      <p className={styles.subtle}>
        Payment runs through Stripe. We never see your card details on our
        side. Cancel anytime from this page.
      </p>
    </section>
  );
}
