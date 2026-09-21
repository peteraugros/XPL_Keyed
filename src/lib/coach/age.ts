// Tim's age, derived from his birthday rather than typed as a number.
//
// 🔴 IT WAS HARDCODED AS "14" IN TWO PLACES AND BOTH WOULD HAVE GONE WRONG ON
// HIS BIRTHDAY, silently, on pages nobody would think to re-read. The age is
// load bearing copy here: "a 14 year old coaching 8 to 14 year olds" is the
// whole pitch, so a stale number undercuts the thing it is there to say.
//
// ⚠️ The marketing home page is PRERENDERED AND CACHED FOR A YEAR
// (s-maxage=31536000, x-nextjs-prerender: 1), so a value computed on the
// server freezes at BUILD time. That is why this is paired with a client side
// correction in MarketingClient, mirroring the existing js-years-since-c2s2
// spans: the server value is right at build and right for crawlers, and the
// browser fixes it for a real visitor if a birthday has passed since.
//
// The portal page is behind auth and not cached that way, so it just calls
// this directly.

/** Tim's birthday. Local midnight, so no timezone shifts the day. */
export const COACH_BIRTHDAY = new Date(2012, 4, 7); // May 7, 2012

/**
 * Whole years old on `asOf`. Counts back from the birthday rather than
 * dividing elapsed milliseconds, so leap years cannot drift it by a day.
 */
export function coachAge(asOf: Date = new Date()): number {
  let age = asOf.getFullYear() - COACH_BIRTHDAY.getFullYear();
  const birthdayThisYear = new Date(
    asOf.getFullYear(),
    COACH_BIRTHDAY.getMonth(),
    COACH_BIRTHDAY.getDate(),
  );
  if (asOf < birthdayThisYear) age -= 1;
  return age;
}
