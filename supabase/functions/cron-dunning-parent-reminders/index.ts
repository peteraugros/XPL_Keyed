// Edge Function — dunning_parent_reminders
//
// Fired daily at 15:00 UTC by pg_cron. Per CLAUDE.md "Dunning & failed payment":
// branded reminder emails to the parent at Day 3 and Day 6 of past_due, on top
// of Stripe's automatic Smart Retries. Stripe's own emails should be disabled
// in the dashboard so we own the voice (per spec).
//
// Idempotency: subscriptions.notified_at_dunning_day3 / notified_at_dunning_day6
// (added in migration 20260517000400_dunning_reminder_columns.sql).
//
// TODO: final email copy (currently placeholder, dash-free per Hard rule #8).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, brandedEmailHtml } from "../_shared/resend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL")!;
const STRIPE_PORTAL_URL = Deno.env.get("STRIPE_PORTAL_URL") ?? "https://billing.stripe.com/p/login";

interface DunningTarget {
  id: string;
  past_due_started_at: string;
  // deno-lint-ignore no-explicit-any
  players: any;
}

async function fetchTargets(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  daysAgo: number,
  notifiedColumn: "notified_at_dunning_day3" | "notified_at_dunning_day6",
): Promise<DunningTarget[]> {
  const threshold = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, past_due_started_at, players(first_name, family_id, families(parents(email)))",
    )
    .eq("status", "past_due")
    .lte("past_due_started_at", threshold)
    .is(notifiedColumn, null);
  if (error) throw new Error(`${notifiedColumn} query: ${error.message}`);
  return (data ?? []) as DunningTarget[];
}

function bodyDay3(firstName: string): string {
  return brandedEmailHtml({
    headline: `Payment hold on ${firstName}'s subscription`,
    bodyHtml: `<p>Your card was declined a few days ago. We've paused ${firstName}'s lessons while you update payment. No charge, no impact on your cycle.</p><p>Update your card to resume.</p>`,
    ctaLabel: "Update card",
    ctaHref: STRIPE_PORTAL_URL,
  });
}

function bodyDay6(firstName: string): string {
  return brandedEmailHtml({
    headline: `Day 6: payment still on hold`,
    bodyHtml: `<p>We're still holding ${firstName}'s spot, but if the card hasn't been updated by Day 14 we'll end the subscription. Progress stays saved if that happens.</p>`,
    ctaLabel: "Update card",
    ctaHref: STRIPE_PORTAL_URL,
  });
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const day3 = await fetchTargets(supabase, 3, "notified_at_dunning_day3");
  const day6 = await fetchTargets(supabase, 6, "notified_at_dunning_day6");

  const stamp = new Date().toISOString();
  let sent = 0;

  for (const sub of day3) {
    const player = sub.players;
    const parentEmail = player?.families?.parents?.[0]?.email;
    const firstName = player?.first_name ?? "your kid";
    if (!parentEmail) continue;
    await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
      to: parentEmail,
      subject: `Payment hold on ${firstName}'s lessons`,
      html: bodyDay3(firstName),
    });
    await supabase.from("subscriptions").update({ notified_at_dunning_day3: stamp }).eq("id", sub.id);
    sent++;
  }

  for (const sub of day6) {
    const player = sub.players;
    const parentEmail = player?.families?.parents?.[0]?.email;
    const firstName = player?.first_name ?? "your kid";
    if (!parentEmail) continue;
    await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
      to: parentEmail,
      subject: `Day 6 reminder: payment still on hold`,
      html: bodyDay6(firstName),
    });
    await supabase.from("subscriptions").update({ notified_at_dunning_day6: stamp }).eq("id", sub.id);
    sent++;
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
