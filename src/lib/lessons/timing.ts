// Lesson delivery timing helpers.
//
// The Sunday cron fires once a week (Sundays at 13:00 UTC) and ships the
// next undelivered curriculum slot to each active subscription. When a
// parent activates their subscription on a non-Sunday with Week 1's live
// call happening before the next Sunday, the cron would miss Week 1
// entirely. In that case we deliver Week 1 immediately on payment.
//
// Rule (per Peter, 2026-05-19):
//   Deliver Week 1 immediately ONLY IF there is no Sunday between the
//   day they booked (= today / cycle_started_at) and Week 1's live call.
//
// "Between" excludes today itself if today happens to be a Sunday — the
// Sunday cron handles that case naturally (and the slot's delivered_at
// guard prevents double-delivery if both this helper and the cron try).

export function shouldDeliverWeek1Immediately(
  paidAt: Date,
  week1LiveCallAt: Date,
): boolean {
  if (week1LiveCallAt.getTime() <= paidAt.getTime()) {
    // Week 1 is already past (shouldn't happen in practice, but bail
    // out cleanly).
    return false;
  }
  const sunday = nextSundayAfter(paidAt);
  // If the next Sunday lands at or before Week 1's live call, the cron
  // will deliver Week 1 on schedule. No immediate delivery needed.
  return sunday.getTime() > week1LiveCallAt.getTime();
}

// First Sunday strictly AFTER the given timestamp. If `from` is itself
// a Sunday, we still return today's date at 00:00 UTC — close enough
// for the comparison above and aligns with the cron's idea of "the
// Sunday for this week."
export function nextSundayAfter(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay();
  // getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
  const daysToAdd = day === 0 ? 0 : 7 - day;
  const next = new Date(d.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  // Anchor to midnight so the comparison ignores time-of-day differences.
  next.setHours(0, 0, 0, 0);
  return next;
}
