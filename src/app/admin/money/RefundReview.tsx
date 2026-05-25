"use client";

// Admin-side refund queue. Lives under /admin/money. Shows pending
// requests first (with Approve / Deny controls) then resolved history
// inline.
//
// Approve = optional note + fires Stripe refund + sends approved email.
// Deny = required note + sends denied email.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./refunds.module.css";

export type PendingRefund = {
  id: string;
  kid_first_name: string | null;
  parent_first_name: string | null;
  parent_email: string | null;
  player_id: string | null;
  amount_cents: number;
  charge_iso: string;
  reason: string;
  requested_iso: string;
};

export type ResolvedRefund = {
  id: string;
  kid_first_name: string | null;
  parent_first_name: string | null;
  amount_cents: number;
  charge_iso: string;
  status: "approved" | "denied";
  decision_note: string | null;
  decided_iso: string | null;
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

function daysAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d <= 0) {
    const h = Math.floor(ms / 3_600_000);
    return h <= 0 ? "just now" : `${h}h ago`;
  }
  return `${d}d ago`;
}

export function RefundReviewSection({
  pending,
  resolved,
}: {
  pending: PendingRefund[];
  resolved: ResolvedRefund[];
}) {
  const total = pending.length + resolved.length;
  if (total === 0) {
    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Refunds</div>
        <h2 className={styles.cardTitle}>Refund requests</h2>
        <p className={styles.cardSubtle}>
          No refund requests right now. Parents request from /portal/billing.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardEyebrow}>Refunds</div>
      <h2 className={styles.cardTitle}>
        Refund requests
        {pending.length > 0 ? (
          <span className={styles.pendingCount}>
            {pending.length} pending
          </span>
        ) : null}
      </h2>

      {pending.length > 0 ? (
        <div className={styles.list}>
          {pending.map((r) => (
            <PendingRow key={r.id} refund={r} />
          ))}
        </div>
      ) : (
        <p className={styles.cardSubtle}>No pending requests.</p>
      )}

      {resolved.length > 0 ? (
        <div className={styles.historySection}>
          <div className={styles.historyLabel}>Past requests</div>
          <ul className={styles.historyList}>
            {resolved.map((r) => (
              <li key={r.id} className={styles.historyRow}>
                <span
                  className={`${styles.statusPill} ${
                    r.status === "approved"
                      ? styles.statusApproved
                      : styles.statusDenied
                  }`}
                >
                  {r.status === "approved" ? "Refunded" : "Denied"}
                </span>
                <div className={styles.historyMeta}>
                  <span className={styles.historyName}>
                    {r.kid_first_name ?? r.parent_first_name ?? "Family"}
                  </span>
                  <span className={styles.historyText}>
                    {fmtUsd(r.amount_cents)} . charged {fmtDate(r.charge_iso)}
                    {r.decided_iso ? ` . decided ${fmtDate(r.decided_iso)}` : ""}
                  </span>
                  {r.decision_note ? (
                    <span className={styles.historyNote}>
                      &quot;{r.decision_note}&quot;
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function PendingRow({ refund }: { refund: PendingRefund }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "approve" | "deny" | "done">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultLabel, setResultLabel] = useState<string | null>(null);

  async function submitApprove() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/refund/${refund.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision_note: note.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(humanError(body.error));
        setBusy(false);
        return;
      }
      setResultLabel("Refunded");
      setMode("done");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  async function submitDeny() {
    setError(null);
    const trimmed = note.trim();
    if (!trimmed) {
      setError("Add a note for the parent so they know why.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/refund/${refund.id}/deny`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision_note: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(humanError(body.error));
        setBusy(false);
        return;
      }
      setResultLabel("Denied");
      setMode("done");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  if (mode === "done") {
    return (
      <div className={styles.row}>
        <div className={styles.rowMeta}>
          <div className={styles.rowName}>
            {refund.kid_first_name ?? "Family"}
          </div>
          <div className={styles.rowSubtle}>
            {fmtUsd(refund.amount_cents)} . {resultLabel}. Email sent.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowMeta}>
        <div className={styles.rowName}>
          {refund.kid_first_name ?? "Family"}
          {refund.parent_first_name ? (
            <span className={styles.rowSubtle}>
              {" "}
              . {refund.parent_first_name}&apos;s family
            </span>
          ) : null}
        </div>
        <div className={styles.rowSubtle}>
          {fmtUsd(refund.amount_cents)} . charged {fmtDate(refund.charge_iso)}{" "}
          . requested {daysAgo(refund.requested_iso)}
        </div>
        <div className={styles.rowQuote}>
          &quot;{refund.reason}&quot;
        </div>

        {mode === "approve" || mode === "deny" ? (
          <div className={styles.decisionBox}>
            <label className={styles.decisionLabel}>
              {mode === "approve"
                ? "Optional note to the parent"
                : "Note to the parent. Required when denying."}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              className={styles.textarea}
              placeholder={
                mode === "approve"
                  ? "Optional. Anything friendly to say to the parent."
                  : "Explain the reason. Keep it kind and specific."
              }
              disabled={busy}
            />
            <div className={styles.actions}>
              <button
                type="button"
                onClick={mode === "approve" ? submitApprove : submitDeny}
                disabled={busy || (mode === "deny" && note.trim().length < 1)}
                className={
                  mode === "approve" ? styles.btnPrimary : styles.btnDanger
                }
              >
                {busy
                  ? mode === "approve"
                    ? "Refunding..."
                    : "Sending..."
                  : mode === "approve"
                    ? `Refund ${fmtUsd(refund.amount_cents)}`
                    : "Send denial"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("idle");
                  setNote("");
                  setError(null);
                }}
                disabled={busy}
                className={styles.btnGhost}
              >
                Back
              </button>
            </div>
            {error ? <div className={styles.error}>{error}</div> : null}
          </div>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => setMode("approve")}
              className={styles.btnPrimary}
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setMode("deny")}
              className={styles.btnDanger}
            >
              Deny
            </button>
            {refund.player_id ? (
              <a
                href={`/admin/clients?client=${refund.player_id}`}
                className={styles.btnGhost}
              >
                Open client card
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function humanError(code: string | undefined): string {
  switch (code) {
    case "not_pending":
      return "Someone already acted on this one. Refresh.";
    case "stripe_refund_failed":
      return "Stripe wouldn't process the refund. Try again or check the Stripe dashboard.";
    case "refund_request_not_found":
      return "Refund request not found. Refresh.";
    case "db_update_failed_after_refund":
      return "Refund went through at Stripe but our DB write failed. Refresh and confirm in Stripe.";
    default:
      return "Something went wrong. Try again.";
  }
}
