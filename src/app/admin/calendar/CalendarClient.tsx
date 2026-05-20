"use client";

// /admin/calendar — list view (Round 1).
//
// Events grouped by date bucket (Today / Tomorrow / This week / Next
// week / Later). Click any event to open the detail modal. Detail
// modal shows everything Tim might want at a glance + a Coach cancel
// form with the locked 3-reason dropdown and type-CANCEL verification.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./calendar.module.css";

export type CalendarEvent =
  | {
      id: string;
      kind: "paid_lesson";
      when_iso: string;
      week_number: number;
      is_vod_review: boolean;
      slot_id: string;
      player_id: string;
      kid_first_name: string;
      kid_fortnite_username: string | null;
      kid_discord_username: string | null;
      kid_current_rank: string | null;
      parent_first_name: string | null;
      parent_email: string | null;
      lesson_fortnite_label: string | null;
      lesson_parent_label: string | null;
      lesson_skill_description: string | null;
      lesson_is_stub: boolean;
      cancelled: boolean;
      cancel_reason: string | null;
      cancel_source: "coach" | "parent" | null;
    }
  | {
      id: string;
      kind: "trial_call";
      when_iso: string;
      subscription_id: string;
      player_id: string;
      kid_first_name: string;
      kid_fortnite_username: string | null;
      kid_discord_username: string | null;
      kid_current_rank: string | null;
      parent_first_name: string | null;
      parent_email: string | null;
    };

type Bucket = "Today" | "Tomorrow" | "This week" | "Next week" | "Later";

function bucketFor(iso: string): Bucket {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const ev = new Date(iso);
  const evDay = new Date(ev);
  evDay.setHours(0, 0, 0, 0);
  const daysOff = Math.floor((evDay.getTime() - start.getTime()) / 86_400_000);
  if (daysOff === 0) return "Today";
  if (daysOff === 1) return "Tomorrow";
  // "This week" = within 7 days, "Next week" = 7..13, else "Later"
  if (daysOff < 7) return "This week";
  if (daysOff < 14) return "Next week";
  return "Later";
}

const BUCKET_ORDER: Bucket[] = ["Today", "Tomorrow", "This week", "Next week", "Later"];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return time.replace(/\s?(AM|PM)/i, (_m, ap: string) => ap.toLowerCase());
}
function fmtFullDateTime(iso: string): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
  return `${datePart} at ${fmtTime(iso)}`;
}
function fmtShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60);
}

export default function CalendarClient({ events }: { events: CalendarEvent[] }) {
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  const buckets = useMemo(() => {
    const map = new Map<Bucket, CalendarEvent[]>();
    for (const b of BUCKET_ORDER) map.set(b, []);
    for (const e of events) {
      map.get(bucketFor(e.when_iso))?.push(e);
    }
    return map;
  }, [events]);

  const openEvent = events.find((e) => e.id === openEventId) ?? null;

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Schedule</div>
        <h1 className={styles.title}>Calendar</h1>
        <p className={styles.intro}>
          Every upcoming live call. Tap an event for full details and to
          cancel if you need to. Day, week, and month views are next.
        </p>
      </section>

      {events.length === 0 ? (
        <section className={styles.card}>
          <p className={styles.empty}>
            Nothing scheduled. As trials get booked and active cycles fill in,
            calls land here.
          </p>
        </section>
      ) : (
        BUCKET_ORDER.map((b) => {
          const list = buckets.get(b) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={b} className={styles.card}>
              <div className={styles.cardEyebrow}>{b}</div>
              <ul className={styles.list}>
                {list.map((e) => (
                  <EventRow key={e.id} event={e} onOpen={() => setOpenEventId(e.id)} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {openEvent ? (
        <EventModal
          event={openEvent}
          onClose={() => setOpenEventId(null)}
        />
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  onOpen,
}: {
  event: CalendarEvent;
  onOpen: () => void;
}) {
  const isPaid = event.kind === "paid_lesson";
  const isVod = isPaid && event.is_vod_review;
  const isCancelled = isPaid && event.cancelled;
  const title = isPaid
    ? (event.lesson_fortnite_label ?? (isVod ? "VOD review" : "Lesson"))
    : "Free trial call";
  const subtitle = isPaid
    ? `Week ${event.week_number} · ${event.kid_first_name}`
    : event.kid_first_name;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`${styles.row} ${isCancelled ? styles.rowCancelled : ""}`}
      >
        <span className={styles.rowTime}>
          <span className={styles.rowTimeDate}>{fmtShortDate(event.when_iso)}</span>
          <span className={styles.rowTimeClock}>{fmtTime(event.when_iso)}</span>
        </span>
        <span className={styles.rowBody}>
          <span className={`${styles.rowTitle} ${isCancelled ? styles.strike : ""}`}>{title}</span>
          <span className={styles.rowSubtitle}>
            {isCancelled && isPaid && event.cancel_reason ? (
              <span className={styles.cancelLabel}>Cancelled. {event.cancel_reason}.</span>
            ) : (
              subtitle
            )}
          </span>
        </span>
        <span
          className={`${styles.kindPill} ${
            isCancelled
              ? styles.pillCancelled
              : isPaid
                ? (isVod ? styles.pillVod : styles.pillPaid)
                : styles.pillTrial
          }`}
        >
          {isCancelled ? "CANCELLED" : isPaid ? (isVod ? "VOD" : "LIVE") : "TRIAL"}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function EventModal({
  event,
  onClose,
}: {
  event: CalendarEvent;
  onClose: () => void;
}) {
  const isPaid = event.kind === "paid_lesson";
  const isVod = isPaid && event.is_vod_review;

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
          onClick={onClose}
          aria-label="Close"
          className={styles.modalClose}
        >
          ×
        </button>
        <div className={styles.modalEyebrow}>
          {isPaid ? (isVod ? "VOD review" : `Week ${event.week_number}`) : "Free trial call"}
        </div>
        <h2 className={styles.modalTitle}>
          {isPaid
            ? (event.lesson_fortnite_label ?? "Lesson")
            : `Intro call with ${event.kid_first_name}`}
        </h2>
        <p className={styles.modalWhen}>{fmtFullDateTime(event.when_iso)}</p>

        {/* Lesson plan */}
        {isPaid ? (
          <div className={styles.modalSection}>
            <div className={styles.modalSectionLabel}>Lesson plan</div>
            {event.lesson_is_stub ? (
              <div className={styles.modalWarn}>
                This lesson is still a stub. Author the slides + voiceover
                before the call.
              </div>
            ) : event.lesson_parent_label ? (
              <>
                <div className={styles.modalSectionText}>
                  <strong>Kid facing:</strong> {event.lesson_fortnite_label}
                </div>
                <div className={styles.modalSectionText}>
                  <strong>Parent facing:</strong> {event.lesson_parent_label}
                </div>
                {event.lesson_skill_description ? (
                  <div className={styles.modalSectionSub}>
                    {event.lesson_skill_description}
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.modalSectionText}>
                {event.lesson_fortnite_label ?? "Lesson"}
              </div>
            )}
          </div>
        ) : null}

        {/* Client identity */}
        <div className={styles.modalSection}>
          <div className={styles.modalSectionLabel}>Client</div>
          <div className={styles.modalSectionText}>
            <strong>{event.kid_first_name}</strong>
            {event.kid_current_rank ? ` · ${event.kid_current_rank}` : null}
          </div>
          {event.kid_fortnite_username ? (
            <div className={styles.modalSectionSub}>
              Fortnite: {event.kid_fortnite_username}
            </div>
          ) : null}
          {event.kid_discord_username ? (
            <div className={styles.modalSectionSub}>
              Discord: {event.kid_discord_username}
            </div>
          ) : null}
          {event.parent_first_name || event.parent_email ? (
            <div className={styles.modalSectionSub}>
              Parent: {event.parent_first_name ?? ""}{" "}
              {event.parent_email ? (
                <a className={styles.modalLink} href={`mailto:${event.parent_email}`}>
                  {event.parent_email}
                </a>
              ) : null}
            </div>
          ) : null}
          <a
            href={`/admin/clients?client=${event.player_id}`}
            className={styles.modalLink}
          >
            Open client card →
          </a>
        </div>

        {/* Cancel state OR cancel form */}
        {isPaid && event.cancelled ? (
          <div className={styles.modalSection}>
            <div className={styles.modalSectionLabel}>Status</div>
            <div className={styles.cancelBanner}>
              <strong>Cancelled.</strong>
              {event.cancel_reason ? ` ${event.cancel_reason}.` : null}
              {event.cancel_source === "parent"
                ? ` The family's records are updated; nothing more to do.`
                : event.cancel_source === "coach"
                  ? ` Family was notified. Cycle pauses one week.`
                  : null}
            </div>
          </div>
        ) : isPaid ? (
          <CoachCancelForm slotId={event.slot_id} kidFirstName={event.kid_first_name} onDone={onClose} when={event.when_iso} />
        ) : (
          <div className={styles.modalSection}>
            <div className={styles.modalSectionLabel}>Cancelling a trial call</div>
            <p className={styles.modalSectionSub}>
              Trial calls cancel through Calendly directly. The webhook
              keeps our records in sync. The in app cancel flow lands here
              in a follow up pass.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coach cancel form
// ---------------------------------------------------------------------------

const REASONS: Array<{ value: "sick" | "out_of_control" | "need_to_reschedule"; label: string }> = [
  { value: "sick", label: "Sick" },
  { value: "out_of_control", label: "Something came up out of my control" },
  { value: "need_to_reschedule", label: "Need to reschedule" },
];

function CoachCancelForm({
  slotId,
  kidFirstName,
  onDone,
  when,
}: {
  slotId: string;
  kidFirstName: string;
  onDone: () => void;
  when: string;
}) {
  const router = useRouter();
  const [showing, setShowing] = useState(false);
  const [reason, setReason] = useState<typeof REASONS[number]["value"]>("sick");
  const [verify, setVerify] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const hours = hoursUntil(when);
  const within24 = hours < 24;

  if (done) {
    return (
      <div className={styles.modalSection}>
        <div className={styles.modalSectionLabel}>Cancelled</div>
        <p className={styles.modalSectionSub}>
          Email sent to the parent. Auto note left for {kidFirstName} in the
          messages thread. {kidFirstName}&apos;s cycle pauses one week.
        </p>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => {
            onDone();
            router.refresh();
          }}
        >
          Done
        </button>
      </div>
    );
  }

  if (!showing) {
    return (
      <div className={styles.modalSection}>
        <button
          type="button"
          className={styles.cancelOpenBtn}
          onClick={() => setShowing(true)}
        >
          Coach cancel this call
        </button>
        <p className={styles.modalSectionSub}>
          Use only if you can&apos;t make the call. The family&apos;s cycle
          pauses one week. No skip charged.
        </p>
      </div>
    );
  }

  async function submit() {
    setError(null);
    if (verify.trim().toUpperCase() !== "CANCEL") {
      setError("Type CANCEL to confirm.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/calendar/coach-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot_id: slotId, reason, confirm: "CANCEL" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Cancel failed. Try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
      setSubmitting(false);
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalSection}>
      <div className={styles.modalSectionLabel}>Coach cancel</div>
      {within24 ? (
        <div className={styles.modalWarn}>
          This is within 24 hours of the call. {kidFirstName}&apos;s family
          will likely have already planned for it. Use only if you truly
          can&apos;t make it.
        </div>
      ) : null}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Reason</span>
        <select
          value={reason}
          onChange={(e) =>
            setReason(e.target.value as typeof REASONS[number]["value"])
          }
          className={styles.fieldInput}
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Type CANCEL to confirm</span>
        <input
          type="text"
          value={verify}
          onChange={(e) => setVerify(e.target.value)}
          className={styles.fieldInput}
          placeholder="CANCEL"
          autoComplete="off"
        />
      </label>
      {error ? <div className={styles.modalError}>{error}</div> : null}
      <div className={styles.modalActions}>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || verify.trim().toUpperCase() !== "CANCEL"}
          className={styles.cancelBtn}
        >
          {submitting ? "Cancelling..." : "Confirm cancel"}
        </button>
        <button
          type="button"
          onClick={() => setShowing(false)}
          disabled={submitting}
          className={styles.cancelLinkBtn}
        >
          Never mind
        </button>
      </div>
    </div>
  );
}
