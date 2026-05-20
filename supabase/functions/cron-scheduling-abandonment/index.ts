// Edge Function — scheduling_abandonment
//
// Phase 2 of the trial conversion flow. Per locked spec decision 3, a
// family that has approved their curriculum but hasn't finished booking
// the 4 sessions gets reminded at 24h + 72h, then released at 7d.
//
// Fired hourly by pg_cron. Filters subscriptions where:
//   lifecycle_state IN (ACCEPTED_PENDING_SCHEDULING, SCHEDULING_IN_PROGRESS)
//
// Per-subscription idempotency: scheduling_reminder_24h_at and
// scheduling_reminder_72h_at on subscriptions. Once 7d has elapsed
// since scheduling_started_at, the slots are released + lifecycle is
// reset to ACCEPTED_PENDING_SCHEDULING and the timestamps cleared.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, brandedEmailHtml } from "../_shared/resend.ts";

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
  scheduling_started_at: string | null;
  scheduling_reminder_24h_at: string | null;
  scheduling_reminder_72h_at: string | null;
  players: { first_name: string; family_id: string } | null;
};

function reminder24Html(kid: string, remaining: number, url: string): string {
  return brandedEmailHtml({
    headline: `Finish reserving ${kid}'s sessions`,
    bodyHtml: `<p>You still have ${remaining} session${remaining === 1 ? "" : "s"} left to reserve for ${kid}. Pick your slots when you have a minute so I can get the first lesson ready.</p>${SIGNATURE}`,
    ctaLabel: "Reserve lesson times",
    ctaHref: url,
  });
}

function reminder72Html(kid: string, url: string): string {
  return brandedEmailHtml({
    headline: `Complete your lesson booking`,
    bodyHtml: `<p>Heads up — please finish reserving ${kid}'s sessions before your spot expires. We hold reserved times for 7 days; after that the booking resets and ${kid} has to start over.</p>${SIGNATURE}`,
    ctaLabel: "Reserve lesson times",
    ctaHref: url,
  });
}

function expiredHtml(kid: string, url: string): string {
  return brandedEmailHtml({
    headline: `Your reserved times expired`,
    bodyHtml: `<p>Your reserved lesson times for ${kid} expired since the 4 weekly sessions weren't all picked within 7 days. No charge happened. You can restart onboarding any time — Tim's plan for ${kid} is still in your dashboard.</p>${SIGNATURE}`,
    ctaLabel: "Open dashboard",
    ctaHref: url,
  });
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date();
  const stamp = now.toISOString();
  const t24 = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const t72 = new Date(now.getTime() - 72 * 3_600_000).toISOString();
  const t168 = new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString();

  // Fetch all in-flight scheduling subscriptions in one shot. Small data
  // scale; in-memory filter is fine.
  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select(
      "id, player_id, lifecycle_state, scheduling_started_at, scheduling_reminder_24h_at, scheduling_reminder_72h_at, players(first_name, family_id)",
    )
    .in("lifecycle_state", ["ACCEPTED_PENDING_SCHEDULING", "SCHEDULING_IN_PROGRESS"]);

  if (error) {
    console.error("[cron-scheduling-abandonment] fetch failed", error);
    return new Response("error", { status: 500 });
  }

  let r24 = 0;
  let r72 = 0;
  let expired = 0;

  for (const sub of (subs ?? []) as SubRow[]) {
    if (!sub.scheduling_started_at) continue;
    const kid = sub.players?.first_name ?? "your kid";

    // Lookup parent email.
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

    // Count remaining slots (curriculum -> slots).
    const curriculumRow = await supabase
      .from("curricula")
      .select("id")
      .eq("player_id", sub.player_id)
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const curriculumId = (curriculumRow.data as { id: string } | null)?.id;

    let remaining = 4;
    if (curriculumId) {
      const slotRow = await supabase
        .from("curriculum_slots")
        .select("id, live_call_at")
        .eq("curriculum_id", curriculumId);
      const slots = (slotRow.data ?? []) as Array<{ live_call_at: string | null }>;
      remaining = slots.filter((s) => !s.live_call_at).length;
    }

    // ---- 7d expiry path: highest priority --------------------------------
    if (sub.scheduling_started_at <= t168) {
      // Release all slots for this curriculum.
      if (curriculumId) {
        await supabase
          .from("curriculum_slots")
          .update({ live_call_at: null, live_call_event_id: null })
          .eq("curriculum_id", curriculumId);
        await supabase
          .from("curricula")
          .update({ cycle_anchor_at: null })
          .eq("id", curriculumId);
      }
      // Reset subscription state.
      await supabase
        .from("subscriptions")
        .update({
          lifecycle_state: "ACCEPTED_PENDING_SCHEDULING",
          scheduling_started_at: null,
          scheduling_reminder_24h_at: null,
          scheduling_reminder_72h_at: null,
          payment_pending_at: null,
        })
        .eq("id", sub.id);
      await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
        to: parentEmail,
        subject: `Your reserved times for ${kid} expired`,
        html: expiredHtml(kid, `${NEXT_PUBLIC_APP_URL}/portal`),
      });
      expired++;
      continue;
    }

    // ---- 72h reminder ----------------------------------------------------
    if (
      sub.scheduling_started_at <= t72 &&
      !sub.scheduling_reminder_72h_at
    ) {
      await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
        to: parentEmail,
        subject: `Complete ${kid}'s lesson booking`,
        html: reminder72Html(kid, `${NEXT_PUBLIC_APP_URL}/portal/sessions`),
      });
      await supabase
        .from("subscriptions")
        .update({ scheduling_reminder_72h_at: stamp })
        .eq("id", sub.id);
      r72++;
      continue;
    }

    // ---- 24h reminder ----------------------------------------------------
    if (
      sub.scheduling_started_at <= t24 &&
      !sub.scheduling_reminder_24h_at
    ) {
      await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
        to: parentEmail,
        subject: `Reserve ${kid}'s sessions`,
        html: reminder24Html(
          kid,
          remaining,
          `${NEXT_PUBLIC_APP_URL}/portal/sessions`,
        ),
      });
      await supabase
        .from("subscriptions")
        .update({ scheduling_reminder_24h_at: stamp })
        .eq("id", sub.id);
      r24++;
    }
  }

  return new Response(
    JSON.stringify({ reminded_24h: r24, reminded_72h: r72, expired }),
    { headers: { "content-type": "application/json" } },
  );
});
