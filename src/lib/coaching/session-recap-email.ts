// Sends the post session recap to the parent. Delivery only; the words and
// the Hard rule compliance live in ./session-recap-copy.
//
// Why this email exists at all, rather than the Sunday email simply going
// away: measured across all 12 crons, cron-sunday-lesson-delivery was the
// ONLY email a parent received on the happy path. Every other parent email is
// an exception (dunning, pending cancel, scheduling abandonment, payment
// abandonment, waitlist, auto renew off). Delete it with no replacement and a
// family that pays, shows up and has no problems hears nothing from us ever,
// which contradicts the trust model's "parent CC'd on every session reminder
// and post session note".
//
// It is also a better trigger than the old one: the Sunday cron fired on a
// calendar, this fires because Tim actually did the work.

import { brandedEmailHtml } from "@/lib/email/template";
import { sendBrandedEmail } from "@/lib/email/send";
import { buildSessionRecapEmail, type SessionRecapArgs } from "./session-recap-copy";

export type { SessionRecapArgs };

export async function sendSessionRecapEmail(args: SessionRecapArgs): Promise<{ ok: boolean }> {
  if (!process.env.RESEND_API_KEY) return { ok: false };
  const { subject, headline, bodyHtml } = buildSessionRecapEmail(args);
  return sendBrandedEmail({
    to: args.parentEmail,
    subject,
    html: brandedEmailHtml({ headline, bodyHtml }),
    trigger: "session_recap",
    recipientType: "parent",
    relatedEntityType: "curriculum_slot",
    relatedEntityId: args.slotId,
  });
}
