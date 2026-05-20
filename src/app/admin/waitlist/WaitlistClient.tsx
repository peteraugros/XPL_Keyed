"use client";

// Waitlist surface for Tim. Open queue at top, closed history below.
// Per-row Remove action (with confirm + reason). Skip-in-queue is a
// deliberate omission for MVP — strict FIFO matches the locked spec.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WaitlistEntry } from "./page";
import styles from "./waitlist.module.css";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}
function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
function hoursUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60));
}

function statusLabel(e: WaitlistEntry): { label: string; tone: string } {
  switch (e.status) {
    case "waiting":
      return { label: "Waiting", tone: "muted" };
    case "offered": {
      const h = hoursUntil(e.offer_expires_at);
      if (h === null) return { label: "Offered", tone: "ok" };
      if (h <= 0) return { label: "Offer expiring", tone: "warn" };
      return { label: `Offered. ${h}h left`, tone: "ok" };
    }
    case "claimed":
      return { label: "Claimed (in trial)", tone: "ok" };
    case "converted":
      return { label: "Converted (paid)", tone: "ok" };
    case "expired":
      return { label: "Offer expired", tone: "warn" };
    case "removed":
      return { label: "Removed", tone: "muted" };
    default:
      return { label: e.status, tone: "muted" };
  }
}

export default function WaitlistClient({
  open,
  closed,
}: {
  open: WaitlistEntry[];
  closed: WaitlistEntry[];
}) {
  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Funnel</div>
        <h1 className={styles.title}>Waitlist</h1>
        <p className={styles.intro}>
          Families waiting on a slot. The cron handles offers + reminders +
          expiries automatically. Strict FIFO. Tim only steps in to remove a
          ghost family or to handle special cases.
        </p>
      </section>

      <section className={styles.statsRow}>
        <Stat label="Waiting" value={String(open.filter((e) => e.status === "waiting").length)} />
        <Stat label="Active offers" value={String(open.filter((e) => e.status === "offered").length)} />
        <Stat
          label="Oldest waiting"
          value={(() => {
            const waiting = open.filter((e) => e.status === "waiting");
            if (waiting.length === 0) return "—";
            const oldest = waiting[0];
            return `${daysAgo(oldest.created_at)}d`;
          })()}
        />
        <Stat label="Removed all time" value={String(closed.filter((e) => e.status === "removed").length)} />
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Open queue</div>
        <h2 className={styles.cardTitle}>
          {open.length} {open.length === 1 ? "family" : "families"}
        </h2>
        {open.length === 0 ? (
          <p className={styles.cardSubtle}>
            No one waiting. When a slot fills past 12, new families land here.
          </p>
        ) : (
          <ol className={styles.list}>
            {open.map((e, i) => (
              <WaitlistRow key={e.id} entry={e} position={i + 1} />
            ))}
          </ol>
        )}
      </section>

      {closed.length > 0 ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>History</div>
          <h2 className={styles.cardTitle}>
            {closed.length} closed {closed.length === 1 ? "entry" : "entries"}
          </h2>
          <ul className={styles.list}>
            {closed.map((e) => (
              <WaitlistRow key={e.id} entry={e} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function WaitlistRow({
  entry,
  position,
}: {
  entry: WaitlistEntry;
  position?: number;
}) {
  const router = useRouter();
  const { label, tone } = statusLabel(entry);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = entry.status === "waiting" || entry.status === "offered";

  async function doRemove() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/waitlist/${entry.id}/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || "removed_by_coach" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not remove.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowHeader}>
        <div className={styles.rowMain}>
          <span className={styles.rowName}>
            {position ? <span className={styles.position}>#{position}</span> : null}
            {entry.kid_first_name}
            {entry.kid_age ? <span className={styles.age}> · age {entry.kid_age}</span> : null}
          </span>
          <span className={styles.rowMeta}>
            {entry.parent_first_name ? `${entry.parent_first_name} · ` : ""}
            <a href={`mailto:${entry.parent_email}`} className={styles.email}>
              {entry.parent_email}
            </a>
          </span>
          <span className={styles.rowSub}>
            Signed up {fmtDate(entry.created_at)}
            {entry.last_freshness_check_at
              ? ` · Last freshness check ${fmtDate(entry.last_freshness_check_at)}`
              : ""}
            {entry.freshness_response
              ? ` · Last reply: ${entry.freshness_response}`
              : ""}
            {entry.removed_at
              ? ` · Removed ${fmtDate(entry.removed_at)}${entry.removed_reason ? ` (${entry.removed_reason})` : ""}`
              : ""}
          </span>
        </div>
        <span className={`${styles.statusPill} ${styles[`status_${tone}`] ?? ""}`}>{label}</span>
      </div>

      {isOpen ? (
        <div className={styles.rowActions}>
          {confirmRemove ? (
            <div className={styles.confirmBlock}>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional, internal note)"
                className={styles.reasonInput}
                maxLength={200}
              />
              <button
                type="button"
                onClick={doRemove}
                disabled={busy}
                className={styles.removeBtn}
              >
                {busy ? "Removing..." : "Confirm remove"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                disabled={busy}
                className={styles.linkBtn}
              >
                Never mind
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className={styles.linkBtn}
            >
              Remove
            </button>
          )}
          {error ? <span className={styles.rowError}>{error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}
