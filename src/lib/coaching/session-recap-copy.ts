// Post session recap copy. The WORDS and the RULES, with no dependencies.
//
// Split from the sender on purpose, and the split is structural rather than
// stylistic: this file must import nothing, so the Hard rule assertions in
// scripts/verify-coaching-session.mjs can load it directly and check them.
// The first attempt kept the builder beside the sender and the test could not
// import it at all, because the sender pulls in the mail infrastructure and
// the "@/" path alias. A rule you can only check by sending an email is a
// rule nobody checks.
//
// DO NOT ADD AN IMPORT TO THIS FILE. If the copy needs something, pass it in.
//
// HARD RULE #4 IS ENFORCED BY CONSTRUCTION HERE, not by wording discipline.
// The body quotes ONLY parent_summary, which is the parent legible line.
// coach_note and training_routine are written for the player in the game's
// vocabulary, and this function is not even given the routine text, only
// whether one exists. So it cannot carry untranslated Fortnite jargon even if
// Tim writes the whole note in it.
//
// When Tim writes no parent_summary the email STILL SENDS and quotes nothing.
// That is the right failure direction: a parent hearing "there is something
// new to read" is fine, a parent silently hearing nothing is what this exists
// to prevent, and a parent receiving raw jargon is what Hard rule #4 exists
// to prevent.
//
// Hard rule #8: no dash characters in any copy below.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export type SessionRecapArgs = {
  parentEmail: string;
  parentFirstName: string;
  kidFirstName: string;
  /** The parent legible line. Null when Tim did not write one. */
  parentSummary: string | null;
  /** Whether a routine was posted. Its TEXT is deliberately not passed in. */
  hasRoutine: boolean;
  slotId: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Tim types a summary as prose, possibly across lines. Escape first, then
// turn the newlines into breaks, so a multi line summary does not arrive as
// one run on paragraph in the parent's inbox.
function toParagraphs(s: string): string {
  return escapeHtml(s.trim()).replace(/\r?\n/g, "<br/>");
}


// Split from the sender on purpose. Everything Hard rule #4 and Hard rule #8
// govern lives in here, so it can be asserted exhaustively without a network
// call: that the parent legible line is the only session text present, that
// coach_note and training_routine never appear, and that no dash characters
// reach the parent. A rule you can only check by sending an email is a rule
// nobody checks.
// Returns the BODY, not the finished email: the branded shell is applied by
// the sender. That leaves this function with zero imports, so the Hard rule
// assertions can be run against it directly instead of through a transpile
// chain. A rule you can only check by sending an email is a rule nobody
// checks.
export function buildSessionRecapEmail(args: SessionRecapArgs): {
  subject: string;
  headline: string;
  bodyHtml: string;
} {
  const kid = escapeHtml(args.kidFirstName);
  const parent = escapeHtml(args.parentFirstName);
  const progressUrl = `${APP_URL}/portal/progress`;

  const summaryBlock = args.parentSummary
    ? `<p style="border-left:3px solid #C7FF3D;padding:4px 0 4px 12px;margin:16px 0;">
${toParagraphs(args.parentSummary)}
</p>`
    : "";

  const routineLine = args.hasRoutine
    ? `<p>${kid} has a routine to work on before the next call. It is in their dashboard, and in yours.</p>`
    : "";

  const bodyHtml = `<p>Hi ${parent},</p>
<p>${kid} and I just finished a call. Here is where it landed.</p>
${summaryBlock}
${routineLine}
<p>Everything I wrote for ${kid} is on your dashboard, including the note in their own words. <a href="${progressUrl}">Open ${kid}'s progress</a>.</p>
<p>Talk soon,<br/>Tim</p>`;

  return {
    subject: `Today's call with ${args.kidFirstName}`,
    headline: `Today's call with ${kid}`,
    bodyHtml,
  };
}
