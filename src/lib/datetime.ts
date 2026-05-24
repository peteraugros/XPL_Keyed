// Centralized datetime formatters anchored to Tim's coaching timezone
// (Pacific Time). Calendly events are booked against Tim's availability
// in PT; the booking confirmation email shows PT; the parent + kid
// portals should match.
//
// Why hardcode PT instead of using the user's browser timezone? Two reasons:
//   1. Server Components render server-side. Without an explicit
//      timeZone, Intl.DateTimeFormat uses the SERVER's timezone, which
//      is UTC on Railway. That produced the original bug where 4:30pm
//      PT bookings showed as "11:30pm" in the portal.
//   2. Even if we passed the browser tz from the client, mixing
//      timezones across surfaces creates "the email said 4:30pm, the
//      portal said 7:30pm" confusion. Pinning to PT keeps everything
//      consistent with the booking origin.
//
// Future enhancement: detect a parent's tz from their profile or IP
// and offer a "show in my local time" toggle. Until then, PT is the
// canonical display tz everywhere a call time is shown.

export const COACH_TZ = "America/Los_Angeles";
export const COACH_TZ_LABEL = "PT";

// "Friday, May 29 at 4:30pm PT"
export function formatCallDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: COACH_TZ,
  }).format(d);
  return `${datePart} at ${formatTime(iso)}`;
}

// "4:30pm PT" — lowercase am/pm, no space before, PT suffix.
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const raw = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: COACH_TZ,
  }).format(d);
  const cleaned = raw.replace(/\s?(AM|PM)/i, (_m, ap: string) => ap.toLowerCase());
  return `${cleaned} ${COACH_TZ_LABEL}`;
}

// "May 29"
export function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: COACH_TZ,
  }).format(d);
}

// "Friday, May 29, 2026"
export function formatLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: COACH_TZ,
  }).format(d);
}

// "Wed, May 29" — used in compact schedulers
export function formatCompactDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: COACH_TZ,
  }).format(d);
}
