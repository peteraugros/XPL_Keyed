// Edge Function — pending_cancel_lifecycle
//
// Fired daily at 16:00 UTC by pg_cron. Per CLAUDE.md "Cancellation policy":
// when a 3rd cancel attempt registers, the subscription enters pending_cancel
// with a 7-day window. This cron drives the three lifecycle events inside
// that window:
//   * Day 3 reminder email to parent
//   * Day 6 final reminder email to parent
//   * Day 7+ auto-confirm (status → 'canceled', final email sent)
//
// Idempotency columns on subscriptions:
//   pending_cancel_reminder_3day_at
//   pending_cancel_reminder_6day_at
//   pending_cancel_auto_confirm_at (this is the deadline, set at entry; presence
//                                   of status='canceled' is what marks the
//                                   auto-confirm complete)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmailWithLog, brandedEmailHtml } from "../_shared/resend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL")!;
const NEXT_PUBLIC_APP_URL = Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "https://xplkeyed.com";

// deno-lint-ignore no-explicit-any
function parentEmail(sub: any): string | null {
  return sub?.players?.families?.parents?.[0]?.email ?? null;
}

// deno-lint-ignore no-explicit-any
function firstName(sub: any): string {
  return sub?.players?.first_name ?? "your kid";
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const stamp = new Date().toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString();

  const selectClause =
    "id, pending_cancel_started_at, pending_cancel_auto_confirm_at, players(first_name, families(parents(email)))";

  // --- Day 3 reminders --------------------------------------------------
  const { data: d3Subs } = await supabase
    .from("subscriptions")
    .select(selectClause)
    .eq("status", "pending_cancel")
    .lte("pending_cancel_started_at", threeDaysAgo)
    .is("pending_cancel_reminder_3day_at", null);

  let d3Sent = 0;
  for (const sub of d3Subs ?? []) {
    const to = parentEmail(sub);
    const name = firstName(sub);
    if (!to) continue;
    await sendEmailWithLog({
      apiKey: RESEND_API_KEY,
      defaultFrom: RESEND_FROM_EMAIL,
      supabase,
      to,
      subject: `4 days left to confirm or undo ${name}'s cancellation`,
      html: brandedEmailHtml({
        headline: `${name}'s subscription is pending end`,
        bodyHtml: `<p>You have 4 days left to confirm or undo this. No new lessons run and no charges will happen during the pending window.</p><p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
        ctaLabel: "Review options",
        ctaHref: `${NEXT_PUBLIC_APP_URL}/parent/subscription`,
      }),
      trigger: "pending_cancel_reminder_day3",
      recipientType: "parent",
      relatedEntityType: "subscription",
      relatedEntityId: sub.id,
    });
    await supabase
      .from("subscriptions")
      .update({ pending_cancel_reminder_3day_at: stamp })
      .eq("id", sub.id);
    d3Sent++;
  }

  // --- Day 6 reminders --------------------------------------------------
  const { data: d6Subs } = await supabase
    .from("subscriptions")
    .select(selectClause)
    .eq("status", "pending_cancel")
    .lte("pending_cancel_started_at", sixDaysAgo)
    .is("pending_cancel_reminder_6day_at", null);

  let d6Sent = 0;
  for (const sub of d6Subs ?? []) {
    const to = parentEmail(sub);
    const name = firstName(sub);
    if (!to) continue;
    await sendEmailWithLog({
      apiKey: RESEND_API_KEY,
      defaultFrom: RESEND_FROM_EMAIL,
      supabase,
      to,
      subject: `Last reminder: ${name}'s subscription ends tomorrow`,
      html: brandedEmailHtml({
        headline: `Last reminder`,
        bodyHtml: `<p>Tomorrow ${name}'s subscription ends automatically unless you confirm or undo. Progress is saved if it ends. You can restart any time.</p><p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
        ctaLabel: "Review options",
        ctaHref: `${NEXT_PUBLIC_APP_URL}/parent/subscription`,
      }),
      trigger: "pending_cancel_reminder_day6",
      recipientType: "parent",
      relatedEntityType: "subscription",
      relatedEntityId: sub.id,
    });
    await supabase
      .from("subscriptions")
      .update({ pending_cancel_reminder_6day_at: stamp })
      .eq("id", sub.id);
    d6Sent++;
  }

  // --- Day 7 auto-confirm ------------------------------------------------
  const { data: autoSubs } = await supabase
    .from("subscriptions")
    .select(selectClause)
    .eq("status", "pending_cancel")
    .lte("pending_cancel_auto_confirm_at", stamp);

  let autoCanceled = 0;
  for (const sub of autoSubs ?? []) {
    const to = parentEmail(sub);
    const name = firstName(sub);
    // Atomic state move: pending_cancel → canceled.
    await supabase
      .from("subscriptions")
      .update({ status: "canceled" })
      .eq("id", sub.id);
    if (to) {
      await sendEmailWithLog({
        apiKey: RESEND_API_KEY,
        defaultFrom: RESEND_FROM_EMAIL,
        supabase,
        to,
        subject: `${name}'s subscription has ended`,
        html: brandedEmailHtml({
          headline: `${name}'s subscription has ended`,
          bodyHtml: `<p>I've paused ${name}'s subscription. Progress is saved. Restart any time.</p><p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
          ctaLabel: "Restart subscription",
          ctaHref: `${NEXT_PUBLIC_APP_URL}/parent/restart`,
        }),
        trigger: "pending_cancel_auto_confirmed",
        recipientType: "parent",
        relatedEntityType: "subscription",
        relatedEntityId: sub.id,
      });
    }
    autoCanceled++;
  }

  return new Response(
    JSON.stringify({ d3Sent, d6Sent, autoCanceled }),
    { headers: { "Content-Type": "application/json" } },
  );
});
