"use client";

// /admin/calendar — List / Day / Week / Month views.
//
// View toggle persists in local state (no URL plumbing, no DB column);
// defaults to List on every load. Date nav (Prev / Today / Next) only
// shows for Day/Week/Month — List doesn't have a focal date.
//
// Click any event in any view → same EventModal at the top level.
// Cancel + outcome forms live inside the modal unchanged.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./calendar.module.css";

type ViewMode = "list" | "day" | "week" | "month";

export type CalendarEvent =
  | {
      id: string;
      kind: "paid_lesson";
      when_iso: string;
      delivered_at: string | null;
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
      delivered_at: string | null; // always null for trial; unifies the shape
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

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

const HOUR_START = 8; // 8am
const HOUR_END = 22; // 10pm exclusive
const HOUR_COUNT = HOUR_END - HOUR_START; // 14
const PX_PER_HOUR = 48;

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfWeek(d: Date): Date {
  // Sunday start. getDay(): Sun=0..Sat=6
  const r = startOfDay(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}
function startOfMonth(d: Date): Date {
  const r = startOfDay(d);
  r.setDate(1);
  return r;
}
function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}
function fmtMonthYear(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(d);
}
function fmtWeekRange(d: Date): string {
  const start = startOfWeek(d);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const startFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(start);
  const endFmt = new Intl.DateTimeFormat("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: "numeric",
  }).format(end);
  return `${startFmt} to ${endFmt}`;
}
function fmtDayHeading(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export default function CalendarClient({ events }: { events: CalendarEvent[] }) {
  const [view, setView] = useState<ViewMode>("list");
  const [focalDate, setFocalDate] = useState<Date>(() => startOfDay(new Date()));
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  const openEvent = events.find((e) => e.id === openEventId) ?? null;

  function shiftDate(dir: -1 | 1): void {
    setFocalDate((prev) => {
      if (view === "day") return addDays(prev, dir);
      if (view === "week") return addDays(prev, dir * 7);
      if (view === "month") return addMonths(prev, dir);
      return prev; // list view has no focal date
    });
  }

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Schedule</div>
        <h1 className={styles.title}>Calendar</h1>
        <p className={styles.intro}>
          Every upcoming live call. Tap an event for full details and to
          cancel if you need to.
        </p>
      </section>

      <div className={styles.toolbar}>
        <ViewToggle current={view} onChange={setView} />
        {view !== "list" ? (
          <DateNav
            view={view}
            focalDate={focalDate}
            onPrev={() => shiftDate(-1)}
            onNext={() => shiftDate(1)}
            onToday={() => setFocalDate(startOfDay(new Date()))}
          />
        ) : null}
      </div>

      {view === "list" ? (
        <ListView events={events} onOpen={(id) => setOpenEventId(id)} />
      ) : view === "day" ? (
        <DayView events={events} focalDate={focalDate} onOpen={(id) => setOpenEventId(id)} />
      ) : view === "week" ? (
        <WeekView events={events} focalDate={focalDate} onOpen={(id) => setOpenEventId(id)} />
      ) : (
        <MonthView events={events} focalDate={focalDate} onOpen={(id) => setOpenEventId(id)} />
      )}

      {openEvent ? (
        <EventModal event={openEvent} onClose={() => setOpenEventId(null)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View toggle + date nav
// ---------------------------------------------------------------------------

function ViewToggle({
  current,
  onChange,
}: {
  current: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const opts: Array<{ value: ViewMode; label: string }> = [
    { value: "list", label: "List" },
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
  ];
  return (
    <div className={styles.viewToggle} role="tablist" aria-label="Calendar view">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={current === o.value}
          className={`${styles.viewToggleBtn} ${
            current === o.value ? styles.viewToggleBtnActive : ""
          }`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DateNav({
  view,
  focalDate,
  onPrev,
  onNext,
  onToday,
}: {
  view: ViewMode;
  focalDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const label =
    view === "day"
      ? fmtDayHeading(focalDate)
      : view === "week"
        ? fmtWeekRange(focalDate)
        : fmtMonthYear(focalDate);
  return (
    <div className={styles.dateNav}>
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous"
        className={styles.dateNavBtn}
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onToday}
        className={styles.dateNavToday}
      >
        Today
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next"
        className={styles.dateNavBtn}
      >
        ›
      </button>
      <span className={styles.dateNavLabel}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List view (preserves Round 1 behavior — future + cancelled past only)
// ---------------------------------------------------------------------------

function ListView({
  events,
  onOpen,
}: {
  events: CalendarEvent[];
  onOpen: (id: string) => void;
}) {
  const visibleEvents = useMemo(() => {
    const cutoff = startOfDay(new Date()).getTime();
    return events.filter((e) => {
      const t = new Date(e.when_iso).getTime();
      if (t >= cutoff) return true;
      // Past: include cancelled paid lessons so the strikethrough surfaces
      return e.kind === "paid_lesson" && e.cancelled;
    });
  }, [events]);

  const buckets = useMemo(() => {
    const map = new Map<Bucket, CalendarEvent[]>();
    for (const b of BUCKET_ORDER) map.set(b, []);
    for (const e of visibleEvents) {
      map.get(bucketFor(e.when_iso))?.push(e);
    }
    return map;
  }, [visibleEvents]);

  if (visibleEvents.length === 0) {
    return (
      <section className={styles.card}>
        <p className={styles.empty}>
          Nothing scheduled. As trials get booked and active cycles fill in,
          calls land here.
        </p>
      </section>
    );
  }

  return (
    <>
      {BUCKET_ORDER.map((b) => {
        const list = buckets.get(b) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={b} className={styles.card}>
            <div className={styles.cardEyebrow}>{b}</div>
            <ul className={styles.list}>
              {list.map((e) => (
                <EventRow key={e.id} event={e} onOpen={() => onOpen(e.id)} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Day view — single column, 8am to 10pm hour rows, events absolutely
// positioned by time. Current-time line redraws every minute.
// ---------------------------------------------------------------------------

function DayView({
  events,
  focalDate,
  onOpen,
}: {
  events: CalendarEvent[];
  focalDate: Date;
  onOpen: (id: string) => void;
}) {
  const dayEvents = useMemo(
    () => events.filter((e) => sameDay(new Date(e.when_iso), focalDate)),
    [events, focalDate],
  );
  const today = sameDay(focalDate, new Date());

  return (
    <section className={styles.gridCard}>
      <div className={styles.dayGrid}>
        <HourLabels />
        <div className={styles.dayColumn}>
          {Array.from({ length: HOUR_COUNT }).map((_, i) => (
            <div key={i} className={styles.hourSlot} />
          ))}
          {today ? <NowLine /> : null}
          {dayEvents.map((e) => (
            <PositionedEvent key={e.id} event={e} onOpen={() => onOpen(e.id)} />
          ))}
          {dayEvents.length === 0 ? (
            <div className={styles.gridEmpty}>No calls this day.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Week view — 7 columns × hour rows. Sunday start.
// ---------------------------------------------------------------------------

function WeekView({
  events,
  focalDate,
  onOpen,
}: {
  events: CalendarEvent[];
  focalDate: Date;
  onOpen: (id: string) => void;
}) {
  const weekStart = startOfWeek(focalDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = new Date();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const d of days) map.set(d.toDateString(), []);
    for (const e of events) {
      const key = startOfDay(new Date(e.when_iso)).toDateString();
      map.get(key)?.push(e);
    }
    return map;
  }, [events, days]);

  return (
    <section className={styles.gridCard}>
      <div className={styles.weekHeaderRow}>
        <div className={styles.weekHeaderCorner} />
        {days.map((d) => {
          const today = sameDay(d, now);
          return (
            <div
              key={d.toISOString()}
              className={`${styles.weekHeaderCell} ${today ? styles.weekHeaderCellToday : ""}`}
            >
              <span className={styles.weekHeaderDow}>
                {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d)}
              </span>
              <span className={styles.weekHeaderDate}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.weekGrid}>
        <HourLabels />
        {days.map((d) => {
          const dayList = eventsByDay.get(d.toDateString()) ?? [];
          const today = sameDay(d, now);
          return (
            <div key={d.toISOString()} className={styles.weekDayColumn}>
              {Array.from({ length: HOUR_COUNT }).map((_, i) => (
                <div key={i} className={styles.hourSlot} />
              ))}
              {today ? <NowLine /> : null}
              {dayList.map((e) => (
                <PositionedEvent key={e.id} event={e} onOpen={() => onOpen(e.id)} compact />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Month view — 6 rows × 7 cols. Each cell has day number + up to 3 event
// chips + "+N more" overflow indicator.
// ---------------------------------------------------------------------------

const MAX_CHIPS_PER_CELL = 3;

function MonthView({
  events,
  focalDate,
  onOpen,
}: {
  events: CalendarEvent[];
  focalDate: Date;
  onOpen: (id: string) => void;
}) {
  const monthStart = startOfMonth(focalDate);
  const gridStart = startOfWeek(monthStart);
  // 6 weeks always — handles months that span 6 weeks (rare but real).
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const now = new Date();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = startOfDay(new Date(e.when_iso)).toDateString();
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    // Sort each day's events chronologically
    for (const arr of map.values()) {
      arr.sort((a, b) => a.when_iso.localeCompare(b.when_iso));
    }
    return map;
  }, [events]);

  const dayHeaderLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <section className={styles.gridCard}>
      <div className={styles.monthHeaderRow}>
        {dayHeaderLabels.map((d) => (
          <div key={d} className={styles.monthHeaderCell}>{d}</div>
        ))}
      </div>
      <div className={styles.monthGrid}>
        {cells.map((d) => {
          const inMonth = d.getMonth() === monthStart.getMonth();
          const today = sameDay(d, now);
          const dayList = eventsByDay.get(d.toDateString()) ?? [];
          const visible = dayList.slice(0, MAX_CHIPS_PER_CELL);
          const overflow = dayList.length - visible.length;
          return (
            <div
              key={d.toISOString()}
              className={`${styles.monthCell} ${
                inMonth ? "" : styles.monthCellOutside
              } ${today ? styles.monthCellToday : ""}`}
            >
              <div className={styles.monthCellNum}>{d.getDate()}</div>
              <div className={styles.monthCellChips}>
                {visible.map((e) => (
                  <MonthChip key={e.id} event={e} onOpen={() => onOpen(e.id)} />
                ))}
                {overflow > 0 ? (
                  <div className={styles.monthCellMore}>+{overflow} more</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MonthChip({
  event,
  onOpen,
}: {
  event: CalendarEvent;
  onOpen: () => void;
}) {
  const isPaid = event.kind === "paid_lesson";
  const isVod = isPaid && event.is_vod_review;
  const isCancelled = isPaid && event.cancelled;
  const past = isPast(event.when_iso);
  const cls = isCancelled
    ? styles.monthChipCancelled
    : isPaid
      ? isVod
        ? styles.monthChipVod
        : styles.monthChipPaid
      : styles.monthChipTrial;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${styles.monthChip} ${cls} ${past ? styles.monthChipPast : ""}`}
      title={`${fmtTime(event.when_iso)} · ${event.kid_first_name}`}
    >
      <span className={styles.monthChipTime}>{fmtTime(event.when_iso)}</span>
      <span className={styles.monthChipName}>{event.kid_first_name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared grid pieces — hour labels column, current-time line, positioned
// event block (used by Day + Week).
// ---------------------------------------------------------------------------

function HourLabels() {
  return (
    <div className={styles.hourLabels}>
      {Array.from({ length: HOUR_COUNT }).map((_, i) => {
        const hour = HOUR_START + i;
        const display =
          hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`;
        return (
          <div key={hour} className={styles.hourLabel}>
            {display}
          </div>
        );
      })}
    </div>
  );
}

function NowLine() {
  // Re-render every minute so the line tracks live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const now = new Date();
  const hourFloat = now.getHours() + now.getMinutes() / 60;
  if (hourFloat < HOUR_START || hourFloat >= HOUR_END) return null;
  const offsetPx = (hourFloat - HOUR_START) * PX_PER_HOUR;
  return (
    <div
      className={styles.nowLine}
      style={{ top: `${offsetPx}px` }}
      aria-hidden
    />
  );
}

function PositionedEvent({
  event,
  onOpen,
  compact,
}: {
  event: CalendarEvent;
  onOpen: () => void;
  compact?: boolean;
}) {
  const d = new Date(event.when_iso);
  const hourFloat = d.getHours() + d.getMinutes() / 60;
  // Clamp into the visible band so off-hours events still render at the edge
  const visible = hourFloat >= HOUR_START && hourFloat < HOUR_END;
  if (!visible) return null;
  const top = (hourFloat - HOUR_START) * PX_PER_HOUR;
  const isPaid = event.kind === "paid_lesson";
  const isVod = isPaid && event.is_vod_review;
  const isCancelled = isPaid && event.cancelled;
  const past = isPast(event.when_iso);
  const cls = isCancelled
    ? styles.gridEventCancelled
    : isPaid
      ? isVod
        ? styles.gridEventVod
        : styles.gridEventPaid
      : styles.gridEventTrial;
  const title = isPaid
    ? (event.lesson_fortnite_label ?? (isVod ? "VOD review" : "Lesson"))
    : "Free trial call";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${styles.gridEvent} ${cls} ${past ? styles.gridEventPast : ""} ${
        compact ? styles.gridEventCompact : ""
      }`}
      style={{ top: `${top}px`, height: `${PX_PER_HOUR - 4}px` }}
    >
      <span className={styles.gridEventTime}>{fmtTime(event.when_iso)}</span>
      <span className={styles.gridEventTitle}>
        {compact ? event.kid_first_name : `${title} · ${event.kid_first_name}`}
      </span>
    </button>
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

        {/* Decision tree for the action section:
              cancelled                 → status banner (terminal)
              past + not yet outcome'd  → OutcomeForm (mark done / no_show / late cancel)
              upcoming                  → CoachCancelForm (proactive cancel)
              trial                     → placeholder */}
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
        ) : isPaid && hoursUntil(event.when_iso) <= 0 ? (
          <OutcomeForm
            slotId={event.slot_id}
            kidFirstName={event.kid_first_name}
            onDone={onClose}
          />
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

// ---------------------------------------------------------------------------
// Post-call outcome form (Round 2)
// ---------------------------------------------------------------------------
// Renders inside the event modal once live_call_at has passed. Three
// outcomes: It happened / Student no-show / I had to cancel last minute.

type Outcome = "done" | "no_show" | "coach_cancel_late" | null;

function OutcomeForm({
  slotId,
  kidFirstName,
  onDone,
}: {
  slotId: string;
  kidFirstName: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [coachNote, setCoachNote] = useState("");
  const [chargeSkip, setChargeSkip] = useState(true);
  const [reason, setReason] =
    useState<typeof REASONS[number]["value"]>("sick");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!outcome) return;
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { slot_id: slotId, outcome };
      if (outcome === "done") body.coach_note = coachNote.trim() || undefined;
      if (outcome === "no_show") body.charge_skip = chargeSkip;
      if (outcome === "coach_cancel_late") body.reason = reason;

      const res = await fetch("/api/admin/calendar/mark-outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const r = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(r.error ?? "Mark failed. Try again.");
        setSubmitting(false);
        return;
      }
      const msg =
        outcome === "done"
          ? "Marked done. Cycle counter advanced."
          : outcome === "no_show"
            ? chargeSkip
              ? `Marked no show. 1 skip charged. ${kidFirstName}'s parent emailed.`
              : `Marked no show. Courtesy pass — no skip charged. ${kidFirstName}'s parent emailed.`
            : `Marked as late cancel. ${kidFirstName}'s parent and ${kidFirstName} both notified.`;
      setDone(msg);
      setSubmitting(false);
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={styles.modalSection}>
        <div className={styles.modalSectionLabel}>Marked</div>
        <p className={styles.modalSectionText}>{done}</p>
        <button
          type="button"
          className={styles.outcomeBtn}
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

  return (
    <div className={styles.modalSection}>
      <div className={styles.modalSectionLabel}>How did this call go?</div>
      <div className={styles.outcomeRow}>
        <button
          type="button"
          onClick={() => setOutcome("done")}
          className={`${styles.outcomeBtn} ${outcome === "done" ? styles.outcomeBtnActiveOk : ""}`}
        >
          ✅ It happened
        </button>
        <button
          type="button"
          onClick={() => setOutcome("no_show")}
          className={`${styles.outcomeBtn} ${outcome === "no_show" ? styles.outcomeBtnActiveWarn : ""}`}
        >
          🟡 Student no show
        </button>
        <button
          type="button"
          onClick={() => setOutcome("coach_cancel_late")}
          className={`${styles.outcomeBtn} ${outcome === "coach_cancel_late" ? styles.outcomeBtnActiveEpic : ""}`}
        >
          🟠 I had to cancel
        </button>
      </div>

      {outcome === "done" ? (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Note for the parent (optional)</span>
            <textarea
              value={coachNote}
              onChange={(e) => setCoachNote(e.target.value)}
              className={styles.fieldInput}
              rows={3}
              maxLength={2000}
              placeholder={`e.g. ${kidFirstName} crushed the tunneling drills today. Working on edit-confirm timing next.`}
            />
          </label>
          <p className={styles.modalSectionSub}>
            Surfaces on the parent&apos;s Progress page. Strategic moat
            material; specifics &gt; generic praise.
          </p>
        </>
      ) : null}

      {outcome === "no_show" ? (
        <>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={chargeSkip}
              onChange={(e) => setChargeSkip(e.target.checked)}
            />
            <span>
              Count as 1 skip ({chargeSkip ? "default" : "uncheck for courtesy pass"})
            </span>
          </label>
          <p className={styles.modalSectionSub}>
            {chargeSkip
              ? `${kidFirstName} keeps the slides + voiceover. Cycle advances. Parent gets "Hope all is well" email.`
              : `No skip charged. Cycle pauses one week. Parent still gets "Hope all is well, no charge" email. Use only for real emergencies.`}
          </p>
        </>
      ) : null}

      {outcome === "coach_cancel_late" ? (
        <>
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
          <p className={styles.modalSectionSub}>
            Treated as a coach cancel: family&apos;s cycle pauses one week,
            no skip charged. Parent gets an apology email in your voice.
          </p>
        </>
      ) : null}

      {error ? <div className={styles.modalError}>{error}</div> : null}

      {outcome ? (
        <div className={styles.modalActions}>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={styles.outcomeSubmitBtn}
          >
            {submitting ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            disabled={submitting}
            className={styles.cancelLinkBtn}
          >
            Pick a different outcome
          </button>
        </div>
      ) : null}
    </div>
  );
}
