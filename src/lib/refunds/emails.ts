// Branded email senders for the refund request flow. All copy is
// dash-free per Hard rule #8. Each function returns `void` and never
// throws — sendBrandedEmail already swallows + logs send failures, the
// caller's main flow should keep going on email outage.

import { sendBrandedEmail } from "@/lib/email/send";
import { brandedEmailHtml } from "@/lib/email/template";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://xplkeyed.com";

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

function formatChargeDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

type RecipientArgs = {
  parentEmail: string;
  parentId: string | null;
  refundRequestId: string;
};

type ReceivedArgs = RecipientArgs & {
  parentFirstName: string;
  amountCents: number;
  chargeDateIso: string;
};

type ApprovedArgs = RecipientArgs & {
  parentFirstName: string;
  amountCents: number;
  chargeDateIso: string;
  decisionNote: string | null;
};

type DeniedArgs = RecipientArgs & {
  parentFirstName: string;
  amountCents: number;
  chargeDateIso: string;
  decisionNote: string;
};

// "We got your request, Peter will respond within 24 hours."
export async function sendRefundRequestReceivedEmail(args: ReceivedArgs): Promise<void> {
  const html = brandedEmailHtml({
    headline: "Your refund request is in",
    bodyHtml: `
      <p>Hi ${args.parentFirstName},</p>
      <p>
        We received your refund request for the
        ${formatUsd(args.amountCents)} charge from ${formatChargeDate(args.chargeDateIso)}.
      </p>
      <p>
        Peter (Tim's dad, who runs the back end of XPL Keyed) reviews
        every refund personally. You'll hear back within 24 hours.
      </p>
      <p>
        If you want to add more context in the meantime, have your kid message Tim from the player view. We'll pick it up before the decision lands.
      </p>
      <p style="margin-top:18px;color:rgba(255,255,255,0.6);font-size:13px;">
        Need to come back later? Sign in any time at xplkeyed.com/login.
      </p>
    `,
    ctaLabel: "Open dashboard",
    ctaHref: `${APP_URL}/portal/billing`,
  });

  await sendBrandedEmail({
    to: args.parentEmail,
    subject: "We got your refund request",
    html,
    trigger: "refund_request_received",
    recipientType: "parent",
    recipientId: args.parentId,
    relatedEntityType: "refund_request",
    relatedEntityId: args.refundRequestId,
  });
}

// "Your refund is processed."
export async function sendRefundApprovedEmail(args: ApprovedArgs): Promise<void> {
  const noteBlock = args.decisionNote
    ? `<p style="margin-top:18px;padding:14px 16px;border-left:3px solid #C7FF3D;background:rgba(199,255,61,0.08);">${args.decisionNote.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`
    : "";

  const html = brandedEmailHtml({
    headline: "Refund on the way",
    bodyHtml: `
      <p>Hi ${args.parentFirstName},</p>
      <p>
        Your refund of ${formatUsd(args.amountCents)} (charged ${formatChargeDate(args.chargeDateIso)})
        has been approved and processed.
      </p>
      <p>
        The refund usually appears on your statement in 5 to 10 business days.
        Stripe handles the actual move; we don't see the timing on our end.
      </p>
      ${noteBlock}
      <p style="margin-top:24px;">
        Your account stays open. Lesson history is preserved in case
        ${args.parentFirstName} ever wants to come back.
      </p>
      <p style="margin-top:18px;color:rgba(255,255,255,0.6);font-size:13px;">
        Need to come back later? Sign in any time at xplkeyed.com/login.
      </p>
    `,
    ctaLabel: "Open dashboard",
    ctaHref: `${APP_URL}/portal/billing`,
  });

  await sendBrandedEmail({
    to: args.parentEmail,
    subject: `Refund of ${formatUsd(args.amountCents)} processed`,
    html,
    trigger: "refund_request_approved",
    recipientType: "parent",
    recipientId: args.parentId,
    relatedEntityType: "refund_request",
    relatedEntityId: args.refundRequestId,
  });
}

// "We've reviewed your request and can't process it. Here's why."
export async function sendRefundDeniedEmail(args: DeniedArgs): Promise<void> {
  const html = brandedEmailHtml({
    headline: "About your refund request",
    bodyHtml: `
      <p>Hi ${args.parentFirstName},</p>
      <p>
        Peter reviewed your refund request for the
        ${formatUsd(args.amountCents)} charge from ${formatChargeDate(args.chargeDateIso)}.
      </p>
      <p style="margin-top:18px;padding:14px 16px;border-left:3px solid #C7FF3D;background:rgba(199,255,61,0.08);">
        ${args.decisionNote.replace(/</g, "&lt;").replace(/\n/g, "<br>")}
      </p>
      <p style="margin-top:24px;">
        If you want to talk it through, message Tim from the player view and Peter will jump in.
      </p>
      <p style="margin-top:18px;color:rgba(255,255,255,0.6);font-size:13px;">
        Need to come back later? Sign in any time at xplkeyed.com/login.
      </p>
    `,
    ctaLabel: "Open dashboard",
    ctaHref: `${APP_URL}/portal/billing`,
  });

  await sendBrandedEmail({
    to: args.parentEmail,
    subject: "About your refund request",
    html,
    trigger: "refund_request_denied",
    recipientType: "parent",
    recipientId: args.parentId,
    relatedEntityType: "refund_request",
    relatedEntityId: args.refundRequestId,
  });
}
