"use client";

// Parent-facing refund flow. Renders below the billing card on
// /portal/billing. Three sub-sections:
//
//   1. Eligible charges — within 60 days, succeeded, not refunded, no
//      open or resolved refund request. Each row has a "Request refund"
//      button that expands into an inline reason form.
//   2. In-progress requests — rows where the parent already submitted
//      and Peter hasn't decided yet.
//   3. History — approved + denied requests, with Peter's decision note
//      surfaced inline.
//
// All three sections are server-rendered initial state; the client
// owns the per-row reveal / submit state and falls back to
// router.refresh() on success.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./refunds.module.css";

export type EligibleCharge = {
  payment_intent_id: string;
  amount_cents: number;
  charge_iso: string;
  label: string;
  days_until_window_close: number;
};

export type InProgressRequest = {
  id: string;
  amount_cents: number;
  charge_iso: string;
  label: string;
  reason: string;
  requested_iso: string;
};

export type ResolvedRequest = {
  id: string;
  amount_cents: number;
  charge_iso: string;
  label: string;
  status: "approved" | "denied";
  decision_note: string | null;
  decided_iso: string | null;
};

type Props = {
  eligible: EligibleCharge[];
  inProgress: InProgressRequest[];
  resolved: ResolvedRequest[];
};

function fmtUsd(cents: number): string {
  const v = (cents / 100).toFixed(2).replace(/\.00$/, "");
  return `$${v}`;
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export function RefundsSection({ eligible, inProgress, resolved }: Props) {
  const hasAny = eligible.length > 0 || inProgress.length > 0 || resolved.length > 0;
  if (!hasAny) return null;

  return (
    <section className={styles.card}>
      <div className={styles.cardEyebrow}>Refunds</div>
      <h2 className={styles.cardTitle}>Request a refund</h2>
      <p className={styles.cardBody}>
        Within 60 days of a charge you can request a refund here. Peter
        reviews each one personally and gets back to you within 24
        hours. After 60 days the request form closes per our policy.
      </p>

      {eligible.length > 0 ? (
        <div className={styles.list}>
          <div className={styles.listLabel}>Eligible charges</div>
          {eligible.map((c) => (
            <EligibleRow key={c.payment_intent_id} charge={c} />
          ))}
        </div>
      ) : null}

      {inProgress.length > 0 ? (
        <div className={styles.list}>
          <div className={styles.listLabel}>Awaiting decision</div>
          {inProgress.map((r) => (
            <div key={r.id} className={styles.row}>
              <div className={styles.rowMeta}>
                <div className={styles.rowAmount}>{fmtUsd(r.amount_cents)}</div>
                <div className={styles.rowSubtle}>
                  {r.label} . Charged {fmtDate(r.charge_iso)}
                </div>
                <div className={styles.rowQuote}>
                  &quot;{r.reason.length > 220 ? `${r.reason.slice(0, 220)}...` : r.reason}&quot;
                </div>
              </div>
              <span className={`${styles.statusPill} ${styles.statusPending}`}>
                Pending . Requested {fmtDate(r.requested_iso)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {resolved.length > 0 ? (
        <div className={styles.list}>
          <div className={styles.listLabel}>Past requests</div>
          {resolved.map((r) => (
            <div key={r.id} className={styles.row}>
              <div className={styles.rowMeta}>
                <div className={styles.rowAmount}>{fmtUsd(r.amount_cents)}</div>
                <div className={styles.rowSubtle}>
                  {r.label} . Charged {fmtDate(r.charge_iso)}
                </div>
                {r.decision_note ? (
                  <div className={styles.rowQuote}>
                    Peter wrote: &quot;{r.decision_note}&quot;
                  </div>
                ) : null}
              </div>
              <span
                className={`${styles.statusPill} ${
                  r.status === "approved" ? styles.statusApproved : styles.statusDenied
                }`}
              >
                {r.status === "approved" ? "Refunded" : "Declined"}
                {r.decided_iso ? ` . ${fmtDate(r.decided_iso)}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function EligibleRow({ charge }: { charge: EligibleCharge }) {
  const router = useRouter();
  const [revealed, setRevealed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = reason.trim();
    if (trimmed.length < 1) {
      setError("Tell Peter why so he can review properly.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/portal/refund/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment_intent_id: charge.payment_intent_id,
          reason: trimmed,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(humanError(body.error));
        setBusy(false);
        return;
      }
      // Server-rendered list will re-fetch the new state on refresh.
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowMeta}>
        <div className={styles.rowAmount}>{fmtUsd(charge.amount_cents)}</div>
        <div className={styles.rowSubtle}>
          {charge.label} . Charged {fmtDate(charge.charge_iso)}
        </div>
        <div className={styles.rowSubtle}>
          {charge.days_until_window_close > 0
            ? `${charge.days_until_window_close} ${charge.days_until_window_close === 1 ? "day" : "days"} left in refund window`
            : "Last day of refund window"}
        </div>

        {revealed ? (
          <form className={styles.form} onSubmit={submit}>
            <label className={styles.formLabel}>
              Why are you asking for a refund?
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              rows={4}
              className={styles.textarea}
              placeholder="A sentence or two is enough. Peter reads every request."
              disabled={busy}
            />
            <div className={styles.formActions}>
              <button
                type="submit"
                disabled={busy || reason.trim().length < 1}
                className={styles.submitBtn}
              >
                {busy ? "Sending..." : "Submit request"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRevealed(false);
                  setError(null);
                  setReason("");
                }}
                disabled={busy}
                className={styles.cancelBtn}
              >
                Cancel
              </button>
            </div>
            {error ? <div className={styles.error}>{error}</div> : null}
          </form>
        ) : null}
      </div>

      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className={styles.requestBtn}
        >
          Request refund
        </button>
      ) : null}
    </div>
  );
}

function humanError(code: string | undefined): string {
  switch (code) {
    case "outside_window":
      return "This charge is outside the 60 day refund window. Refresh and check again.";
    case "request_already_open":
      return "A refund request is already in for this charge.";
    case "already_refunded":
      return "This charge has already been refunded.";
    case "not_your_charge":
      return "We couldn't match that charge to your account. Refresh and try again.";
    case "stripe_lookup_failed":
      return "We couldn't reach the payment provider. Try again in a minute.";
    case "no_stripe_customer":
      return "No payment account on file for your family yet.";
    case "invalid_body":
      return "Add a sentence about why before submitting.";
    default:
      return "Something went wrong. Try again, or message Tim if it keeps happening.";
  }
}
