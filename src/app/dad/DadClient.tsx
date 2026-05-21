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

type WindowedCount = { today: number; week: number };
export type ActivityShape = {
  messages_replied: WindowedCount;
  tasks_completed: WindowedCount;
  calls_done: WindowedCount;
  no_shows: WindowedCount;
  coach_cancels: WindowedCount;
};
export type BusinessShape = {
  paying_clients: number;
  cycle_mrr_cents: number;
  last_7d_revenue_cents: number;
  stripe_balance_cents: number | null;
  next_payout_cents: number | null;
  next_payout_date_iso: string | null;
  stripe_error: string | null;
};
export type OpAlertsShape = {
  sent_24h: number;
  failed_24h: number;
  last_run_by_trigger: Array<{ trigger: string; sent_at: string }>;
};

export default function DadClient({
  dadName,
  queue,
  timDadMessages,
  notifications,
  activity,
  business,
  opAlerts,
}: {
  dadName: string;
  queue: QueueItem[];
  timDadMessages: TimDadMessage[];
  notifications: NotificationRow[];
  activity: ActivityShape;
  business: BusinessShape;
  opAlerts: OpAlertsShape;
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
          <a href="/admin" className={styles.viewAsTimBtn}>View as Tim →</a>
          <span className={styles.coachName}>{dadName}</span>
          <button type="button" onClick={onSignOut} className={styles.signOutBtn}>
            Sign out
          </button>
        </div>
      </header>

      <section className={styles.heroBlock}>
        <h1 className={styles.heroTitle}>Dad dashboard</h1>
        <p className={styles.heroBody}>
          {queue.length === 0
            ? "Nothing stuck. Tim's handling it."
            : `${queue.length} thing${queue.length === 1 ? "" : "s"} Tim escalated. Pick a resolution path on each.`}
        </p>
      </section>

      <ActivityStrip activity={activity} />

      <BusinessGlance business={business} />

      <OperationalAlerts alerts={opAlerts} />

      {queue.length > 0 ? (
        <section>
          <h2 className={styles.sectionHeader}>Stuck queue</h2>
          <ul className={styles.queueList}>
            {queue.map((item) => (
              <StuckRow key={item.id} item={item} router={router} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.channelBlock}>
        <TimDadChannel initialMessages={timDadMessages} viewerRole="dad" />
      </section>

      <NotificationLogPanel rows={notifications} />

      <footer className={styles.footer}>
        Phase 2 Dad surface. View as Tim opens Tim&apos;s admin in the same tab.
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

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Activity strip — Tim today vs Tim this week.
// ---------------------------------------------------------------------------
function ActivityStrip({ activity }: { activity: ActivityShape }) {
  const rows: Array<{ label: string; today: number; week: number }> = [
    { label: "Messages replied", today: activity.messages_replied.today, week: activity.messages_replied.week },
    { label: "Tasks completed", today: activity.tasks_completed.today, week: activity.tasks_completed.week },
    { label: "Calls done", today: activity.calls_done.today, week: activity.calls_done.week },
    { label: "No shows logged", today: activity.no_shows.today, week: activity.no_shows.week },
    { label: "Coach cancels", today: activity.coach_cancels.today, week: activity.coach_cancels.week },
  ];
  const totalToday = rows.reduce((acc, r) => acc + r.today, 0);
  return (
    <section className={styles.panelBlock}>
      <div className={styles.panelHeaderRow}>
        <h2 className={styles.sectionHeader}>Tim activity</h2>
        <span className={styles.subtle}>
          {totalToday === 0 ? "Quiet day so far." : `${totalToday} total today.`}
        </span>
      </div>
      <div className={styles.activityGrid}>
        <div className={styles.activityCol}>
          <div className={styles.activityColLabel}>Today</div>
          {rows.map((r) => (
            <div key={r.label} className={styles.activityRow}>
              <span className={styles.activityLabel}>{r.label}</span>
              <span className={styles.activityValue}>{r.today}</span>
            </div>
          ))}
        </div>
        <div className={styles.activityCol}>
          <div className={styles.activityColLabel}>Last 7 days</div>
          {rows.map((r) => (
            <div key={r.label} className={styles.activityRow}>
              <span className={styles.activityLabel}>{r.label}</span>
              <span className={styles.activityValue}>{r.week}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Business glance — 5 KPI tiles.
// ---------------------------------------------------------------------------
function BusinessGlance({ business }: { business: BusinessShape }) {
  const tiles: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: "Paying clients",
      value: `${business.paying_clients} of 12`,
    },
    {
      label: "Cycle MRR",
      value: formatUsd(business.cycle_mrr_cents),
      hint: "$56 per active monthly client.",
    },
    {
      label: "Last 7 days revenue",
      value: formatUsd(business.last_7d_revenue_cents),
    },
    {
      label: "Stripe balance",
      value: business.stripe_balance_cents !== null ? formatUsd(business.stripe_balance_cents) : "—",
    },
    {
      label: "Next payout",
      value:
        business.next_payout_cents !== null
          ? formatUsd(business.next_payout_cents)
          : "None pending",
      hint: business.next_payout_date_iso
        ? `Arrives ${formatShortDate(business.next_payout_date_iso)}`
        : undefined,
    },
  ];
  return (
    <section className={styles.panelBlock}>
      <div className={styles.panelHeaderRow}>
        <h2 className={styles.sectionHeader}>Business glance</h2>
        {business.stripe_error ? (
          <span className={styles.subtleFail}>Stripe: {business.stripe_error}</span>
        ) : null}
      </div>
      <div className={styles.tileGrid}>
        {tiles.map((t) => (
          <div key={t.label} className={styles.tile}>
            <div className={styles.tileLabel}>{t.label}</div>
            <div className={styles.tileValue}>{t.value}</div>
            {t.hint ? <div className={styles.tileHint}>{t.hint}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Operational alerts — Resend bounce rate + cron freshness.
// ---------------------------------------------------------------------------
const CRON_TRIGGER_EXPECTATIONS: Array<{
  trigger: string;
  label: string;
  staleAfterHours: number;
}> = [
  { trigger: "sunday_lesson_delivery", label: "Sunday lesson delivery", staleAfterHours: 24 * 8 },
  { trigger: "dunning_reminder_day3", label: "Dunning day 3", staleAfterHours: 24 * 30 },
  { trigger: "dunning_reminder_day6", label: "Dunning day 6", staleAfterHours: 24 * 30 },
  { trigger: "pending_cancel_reminder_day3", label: "Pending cancel day 3", staleAfterHours: 24 * 30 },
  { trigger: "scheduling_reminder_24h", label: "Scheduling reminder 24h", staleAfterHours: 24 * 14 },
  { trigger: "payment_reminder_6h", label: "Payment reminder 6h", staleAfterHours: 24 * 14 },
  { trigger: "waitlist_offer_email", label: "Waitlist offer email", staleAfterHours: 24 * 30 },
  { trigger: "auto_renew_subscription_canceled", label: "Auto renew canceled", staleAfterHours: 24 * 60 },
];

function OperationalAlerts({ alerts }: { alerts: OpAlertsShape }) {
  const lastBy = new Map(alerts.last_run_by_trigger.map((r) => [r.trigger, r.sent_at]));
  const failureRate =
    alerts.sent_24h + alerts.failed_24h > 0
      ? alerts.failed_24h / (alerts.sent_24h + alerts.failed_24h)
      : 0;
  const failurePct = (failureRate * 100).toFixed(1);

  return (
    <section className={styles.panelBlock}>
      <div className={styles.panelHeaderRow}>
        <h2 className={styles.sectionHeader}>Operational alerts</h2>
        <span className={alerts.failed_24h > 0 ? styles.subtleFail : styles.subtleOk}>
          {alerts.failed_24h === 0
            ? `All clean. ${alerts.sent_24h} emails sent in last 24h.`
            : `${alerts.failed_24h} of ${alerts.sent_24h + alerts.failed_24h} emails failed in 24h (${failurePct}%).`}
        </span>
      </div>
      <ul className={styles.alertList}>
        {CRON_TRIGGER_EXPECTATIONS.map((c) => {
          const lastRun = lastBy.get(c.trigger);
          let pillClass = styles.alertPillNeutral;
          let label: string;
          if (!lastRun) {
            pillClass = styles.alertPillNeutral;
            label = "no runs yet";
          } else {
            const ageHours = (Date.now() - new Date(lastRun).getTime()) / 3_600_000;
            if (ageHours > c.staleAfterHours) {
              pillClass = styles.alertPillStale;
              label = `last: ${formatAge(lastRun)} ago (stale)`;
            } else {
              pillClass = styles.alertPillOk;
              label = `last: ${formatAge(lastRun)} ago`;
            }
          }
          return (
            <li key={c.trigger} className={styles.alertRow}>
              <span className={styles.alertLabel}>{c.label}</span>
              <span className={pillClass}>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
