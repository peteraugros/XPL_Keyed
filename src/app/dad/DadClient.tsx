"use client";

// Dad's Stuck queue + resolution UI. Per Coach Dashboard Spec/dad-admin-spec.md
// section 3. Three resolution paths per Stuck:
//   * Handle directly — Peter acted out of band; mark resolved, flip source
//     waiting_on -> SYSTEM so it drops out of Tim's queue cleanly.
//   * Send back to Tim with note — write a short note Tim sees on his next
//     view; flip source waiting_on -> TIM.
//   * Mark as no action needed — Tim hit Stuck on something that doesn't
//     actually need Dad; quietly return; flip source waiting_on -> TIM.
//
// Tone in this UI: trusting, brief, never paternal. Per the spec, "the
// admin should make Tim feel like the operator he is."

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import TimDadChannel, { type TimDadMessage } from "@/components/TimDadChannel";

type QueueItem = {
  id: string;
  object_type: string;
  object_id: string;
  reason: string | null;
  created_at: string;
  context: {
    client_name: string | null;
    summary: string;
    extra: Record<string, string | null>;
  };
};

type ResolutionType = "handled_directly" | "returned_to_tim" | "no_action_needed";

type NotificationRow = {
  id: string;
  channel: string;
  trigger: string;
  recipient_type: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
};

export default function DadClient({
  dadName,
  queue,
  timDadMessages,
  notifications,
}: {
  dadName: string;
  queue: QueueItem[];
  timDadMessages: TimDadMessage[];
  notifications: NotificationRow[];
}) {
  const router = useRouter();

  async function onSignOut() {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch { /* fall through */ }
    (router.replace as (u: string) => void)("/login");
    router.refresh();
  }

  return (
    <div className={styles.frame}>
      <header className={styles.topBar}>
        <div className={styles.brand}>XPL KEYED · DAD</div>
        <div className={styles.topMeta}>
          <a href="/admin" className={styles.signOutBtn}>Coach view</a>
          <span className={styles.coachName}>{dadName}</span>
          <button type="button" onClick={onSignOut} className={styles.signOutBtn}>
            Sign out
          </button>
        </div>
      </header>

      <section className={styles.heroBlock}>
        <h1 className={styles.heroTitle}>Stuck queue</h1>
        <p className={styles.heroBody}>
          {queue.length === 0
            ? "Nothing stuck. Tim&apos;s handling it."
            : `${queue.length} thing${queue.length === 1 ? "" : "s"} Tim escalated. Pick a resolution path on each.`}
        </p>
      </section>

      {queue.length > 0 ? (
        <ul className={styles.queueList}>
          {queue.map((item) => (
            <StuckRow key={item.id} item={item} router={router} />
          ))}
        </ul>
      ) : null}

      <section className={styles.channelBlock}>
        <TimDadChannel initialMessages={timDadMessages} viewerRole="dad" />
      </section>

      <NotificationLogPanel rows={notifications} />

      <footer className={styles.footer}>
        Phase 1 Dad surface. Operational alerts, business glance, and View as Tim land later.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent system activity — every transactional email the platform fired.
// Visible only on /admin/dad so Peter can spot patterns without giving
// Tim the noise.
// ---------------------------------------------------------------------------
function NotificationLogPanel({ rows }: { rows: NotificationRow[] }) {
  if (rows.length === 0) {
    return (
      <section className={styles.channelBlock}>
        <h2 className={styles.queueTitle}>Recent system activity</h2>
        <p className={styles.subtle}>No emails sent yet.</p>
      </section>
    );
  }
  const failed = rows.filter((r) => r.status === "failed");
  return (
    <section className={styles.channelBlock}>
      <h2 className={styles.queueTitle}>Recent system activity</h2>
      <p className={styles.subtle}>
        Last {rows.length} transactional emails the platform fired.
        {failed.length > 0 ? ` ${failed.length} failed.` : ""}
      </p>
      <ul className={styles.notifList}>
        {rows.map((r) => (
          <li
            key={r.id}
            className={`${styles.notifRow} ${r.status === "failed" ? styles.notifRowFailed : ""}`}
          >
            <span className={styles.notifTime}>{formatTime(r.created_at)}</span>
            <span className={styles.notifBody}>
              <span className={styles.notifTrigger}>{r.trigger}</span>
              <span className={styles.notifMeta}>
                {r.channel} · {r.recipient_type}
                {r.error_message ? ` · ${r.error_message}` : ""}
              </span>
            </span>
            <span
              className={`${styles.notifStatus} ${
                r.status === "sent"
                  ? styles.notifStatusOk
                  : r.status === "failed"
                    ? styles.notifStatusFail
                    : ""
              }`}
            >
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
  const timeRaw = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${datePart} ${timeRaw.replace(/\s?(AM|PM)/i, (_m, ap: string) => ap.toLowerCase())}`;
}

function StuckRow({
  item,
  router,
}: {
  item: QueueItem;
  router: ReturnType<typeof useRouter>;
}) {
  type Stage = "idle" | "noting" | "submitting" | "done";
  const [stage, setStage] = useState<Stage>("idle");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ResolutionType | null>(null);

  const ageStr = formatAge(item.created_at);
  const objectLabel = item.object_type.replace(/_/g, " ");

  async function submitResolution(resolution_type: ResolutionType, resolution_note?: string) {
    setError(null);
    setChosen(resolution_type);
    setStage("submitting");
    try {
      const res = await fetch("/api/dad/stuck-resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stuck_id: item.id,
          resolution_type,
          resolution_note: resolution_note ?? null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Resolve failed.");
        setStage("noting");
        return;
      }
      setStage("done");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setStage("noting");
    }
  }

  if (stage === "done") {
    return (
      <li className={`${styles.queueItem} ${styles.queueItemDone}`}>
        <div className={styles.queueDoneTitle}>
          Resolved{chosen ? ` (${chosen.replace(/_/g, " ")})` : ""}.
        </div>
        <div className={styles.queueSubtle}>
          {chosen === "returned_to_tim"
            ? "Tim will see your note on his next visit."
            : chosen === "no_action_needed"
              ? "Returned to Tim quietly."
              : "Out of the queue."}
        </div>
      </li>
    );
  }

  return (
    <li className={styles.queueItem}>
      <div className={styles.queueHeader}>
        <div>
          <div className={styles.queueObjectType}>{objectLabel}</div>
          <div className={styles.queueClientName}>
            {item.context.client_name ?? "(no client)"}
          </div>
        </div>
        <div className={styles.queueAge}>{ageStr}</div>
      </div>

      <div className={styles.queueSummary}>{item.context.summary}</div>

      {item.reason ? (
        <div className={styles.queueReason}>
          <span className={styles.queueReasonLabel}>Tim wrote:</span> {item.reason}
        </div>
      ) : (
        <div className={styles.queueReason}>
          <span className={styles.queueReasonLabel}>Tim wrote:</span>{" "}
          <em className={styles.queueReasonEmpty}>(no note)</em>
        </div>
      )}

      {stage === "idle" ? (
        <div className={styles.queueActions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => submitResolution("handled_directly")}
          >
            Handle directly
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => setStage("noting")}
          >
            Send back with note
          </button>
          <button
            type="button"
            className={styles.tertiaryBtn}
            onClick={() => submitResolution("no_action_needed")}
          >
            No action needed
          </button>
        </div>
      ) : null}

      {stage === "noting" || stage === "submitting" ? (
        <div className={styles.queueNoteForm}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Brief, warm, trusting. Just the guidance Tim needs to do this one thing well."
            rows={3}
            maxLength={1000}
            className={styles.queueNoteInput}
            autoFocus
          />
          <div className={styles.queueNoteRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => submitResolution("returned_to_tim", note.trim())}
              disabled={stage === "submitting" || !note.trim()}
            >
              {stage === "submitting" ? "Sending..." : "Send back to Tim"}
            </button>
            <button
              type="button"
              className={styles.tertiaryBtn}
              onClick={() => {
                setStage("idle");
                setNote("");
                setError(null);
              }}
              disabled={stage === "submitting"}
            >
              Cancel
            </button>
            {error ? <span className={styles.queueError}>{error}</span> : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function formatAge(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const ms = Math.max(0, now - then);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
