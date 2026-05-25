// Edge Function — payment_abandonment
//
// Phase 2 of the trial conversion flow. Per locked spec decision 4, a
// family that booked all 4 sessions but didn't complete Stripe checkout
// within 24h has their slots released. Reminders at 6h + 12h.
//
// Fired hourly by pg_cron. Filters subscriptions where:
//   lifecycle_state = 'PENDING_PAYMENT'
//
// Per-subscription idempotency: payment_reminder_6h_at and
// payment_reminder_12h_at on subscriptions. After 24h since
// payment_pending_at, slots are released + lifecycle is reset.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmailWithLog, brandedEmailHtml } from "../_shared/resend.ts";
import { cancelCurriculumEvents } from "../_shared/calendly.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL")!;
const NEXT_PUBLIC_APP_URL =
  Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "https://xplkeyed.com";

const SIGNATURE = `<p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`;

type SubRow = {
  id: string;
  player_id: string;
  lifecycle_state: string;
  payment_pending_at: string | null;
  payment_reminder_6h_at: string | null;
  payment_reminder_12h_at: string | null;
  players: { first_name: string; family_id: string } | null;
};

function reminderHtml(kid: string, hour: 6 | 12, url: string): string {
  const headline =
    hour === 6
      ? `Finish ${kid}'s first cycle`
      : `Last chance to lock in ${kid}'s sessions`;
  const body =
    hour === 6
      ? `<p>All 4 sessions for ${kid} are reserved and waiting on the $56 first-cycle charge. Tap below to finish checkout.</p>`
      : `<p>Your reserved sessions for ${kid} expire in about 12 hours. Complete the $56 first-cycle charge to lock them in before the slots release.</p>`;
  return brandedEmailHtml({
    headline,
    bodyHtml: `${body}${SIGNATURE}`,
    ctaLabel: "Complete checkout",
    ctaHref: url,
  });
}

function expiredHtml(kid: string, url: string): string {
  return brandedEmailHtml({
    headline: `Reserved sessions released`,
    bodyHtml: `<p>The 4 sessions you reserved for ${kid} have been released since checkout wasn't completed within 24 hours. No charge happened. Tim's plan is still in your dashboard — you can re-reserve any time.</p>${SIGNATURE}`,
    ctaLabel: "Re-reserve sessions",
    ctaHref: url,
  });
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date();
  const stamp = now.toISOString();
  const t6 = new Date(now.getTime() - 6 * 3_600_000).toISOString();
  const t12 = new Date(now.getTime() - 12 * 3_600_000).toISOString();
  const t24 = new Date(now.getTime() - 24 * 3_600_000).toISOString();

  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select(
      "id, player_id, lifecycle_state, payment_pending_at, payment_reminder_6h_at, payment_reminder_12h_at, players(first_name, family_id)",
    )
    .eq("lifecycle_state", "PENDING_PAYMENT");

  if (error) {
    console.error("[cron-payment-abandonment] fetch failed", error);
    return new Response("error", { status: 500 });
  }

  let r6 = 0;
  let r12 = 0;
  let expired = 0;

  for (const sub of (subs ?? []) as SubRow[]) {
    if (!sub.payment_pending_at) continue;
    const kid = sub.players?.first_name ?? "your kid";
    const familyId = sub.players?.family_id;
    if (!familyId) continue;

    const parentRow = await supabase
      .from("parents")
      .select("email")
      .eq("family_id", familyId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const parentEmail = (parentRow.data as { email: string } | null)?.email;
    if (!parentEmail) continue;

    // ---- 24h expiry path -------------------------------------------------
    if (sub.payment_pending_at <= t24) {
      const curriculumRow = await supabase
        .from("curricula")
        .select("id")
        .eq("player_id", sub.player_id)
        .eq("status", "pending_approval")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const curriculumId = (curriculumRow.data as { id: string } | null)?.id;
      if (curriculumId) {
        // Cancel any Calendly events the parent booked before abandoning checkout.
        await cancelCurriculumEvents(
          supabase,
          curriculumId,
          "Payment not completed within 24 hours",
        );
        await supabase
          .from("curriculum_slots")
          .update({ live_call_at: null, live_call_event_id: null })
          .eq("curriculum_id", curriculumId);
        await supabase
          .from("curricula")
          .update({ cycle_anchor_at: null })
          .eq("id", curriculumId);
      }
      await supabase
        .from("subscriptions")
        .update({
          lifecycle_state: "ACCEPTED_PENDING_SCHEDULING",
          payment_pending_at: null,
          payment_reminder_6h_at: null,
          payment_reminder_12h_at: null,
        })
        .eq("id", sub.id);
      await sendEmailWithLog({
        apiKey: RESEND_API_KEY,
        defaultFrom: RESEND_FROM_EMAIL,
        supabase,
        to: parentEmail,
        subject: `${kid}'s reserved sessions released`,
        html: expiredHtml(kid, `${NEXT_PUBLIC_APP_URL}/portal/sessions`),
        trigger: "payment_released_24h",
        recipientType: "parent",
        relatedEntityType: "subscription",
        relatedEntityId: sub.id,
      });
      expired++;
      continue;
    }

    // ---- 12h reminder ----------------------------------------------------
    if (sub.payment_pending_at <= t12 && !sub.payment_reminder_12h_at) {
      await sendEmailWithLog({
        apiKey: RESEND_API_KEY,
        defaultFrom: RESEND_FROM_EMAIL,
        supabase,
        to: parentEmail,
        subject: `Last chance to lock in ${kid}'s sessions`,
        html: reminderHtml(kid, 12, `${NEXT_PUBLIC_APP_URL}/portal/sessions`),
        trigger: "payment_reminder_12h",
        recipientType: "parent",
        relatedEntityType: "subscription",
        relatedEntityId: sub.id,
      });
      await supabase
        .from("subscriptions")
        .update({ payment_reminder_12h_at: stamp })
        .eq("id", sub.id);
      r12++;
      continue;
    }

    // ---- 6h reminder -----------------------------------------------------
    if (sub.payment_pending_at <= t6 && !sub.payment_reminder_6h_at) {
      await sendEmailWithLog({
        apiKey: RESEND_API_KEY,
        defaultFrom: RESEND_FROM_EMAIL,
        supabase,
        to: parentEmail,
        subject: `Finish ${kid}'s first cycle`,
        html: reminderHtml(kid, 6, `${NEXT_PUBLIC_APP_URL}/portal/sessions`),
        trigger: "payment_reminder_6h",
        recipientType: "parent",
        relatedEntityType: "subscription",
        relatedEntityId: sub.id,
      });
      await supabase
        .from("subscriptions")
        .update({ payment_reminder_6h_at: stamp })
        .eq("id", sub.id);
      r6++;
    }
  }

  return new Response(
    JSON.stringify({ reminded_6h: r6, reminded_12h: r12, expired }),
    { headers: { "content-type": "application/json" } },
  );
});
