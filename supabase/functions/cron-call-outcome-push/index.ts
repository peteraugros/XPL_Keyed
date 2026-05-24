// Edge Function — cron-call-outcome-push
//
// Fires every 5 minutes. Finds live calls that ended 30+ minutes ago with no
// outcome marked (no live_call_completed_at, no no_show_at, not cancelled)
// and sends Tim a web push: "How did Jake's call go?"
//
// Idempotency: push_outcome_pending_sent_at on curriculum_slots prevents a
// double ping if Tim hasn't marked the outcome before the next firing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

async function pushToCoach(
  supabase: ReturnType<typeof createClient>,
  coachId: string,
  title: string,
  body: string,
  url: string,
  tag: string,
) {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("coach_id", coachId);
  if (!subs?.length) return;

  const payload = JSON.stringify({ title, body, url, tag });
  const expired: string[] = [];

  await Promise.allSettled(
    (subs as SubRow[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 410 || code === 404) expired.push(sub.id);
        else console.error("[push] send failed", sub.endpoint, code);
      }
    }),
  );

  if (expired.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expired);
  }
}

Deno.serve(async (_req) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return new Response("vapid_not_configured", { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Find the active coach (Tim).
  const { data: coach } = await supabase
    .from("coaches")
    .select("id")
    .eq("is_active", true)
    .eq("is_dad", false)
    .limit(1)
    .maybeSingle();
  if (!coach) return new Response("no_coach", { status: 200 });
  const coachId = (coach as { id: string }).id;

  // Slots where the call ended 30+ minutes ago with no outcome logged
  // and no push already sent. Cancelled slots are excluded via the
  // live_call_event_id NOT LIKE 'cancelled:%' filter.
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();

  const { data: slots, error } = await supabase
    .from("curriculum_slots")
    .select(
      "id, live_call_at, live_call_event_id, curricula!inner(player_id, players!inner(first_name))",
    )
    .not("live_call_at", "is", null)
    .lte("live_call_at", thirtyMinAgo)
    .is("live_call_completed_at", null)
    .is("no_show_at", null)
    .is("push_outcome_pending_sent_at", null)
    .not("live_call_event_id", "like", "cancelled:%");

  if (error) {
    console.error("[cron-call-outcome-push]", error);
    return new Response(error.message, { status: 500 });
  }
  if (!slots?.length) return new Response("no_pending", { status: 200 });

  let sent = 0;
  for (const slot of slots) {
    // deno-lint-ignore no-explicit-any
    const player = (slot as any).curricula?.players;
    const firstName = (player?.first_name as string | undefined) ?? "Unknown";

    await pushToCoach(
      supabase,
      coachId,
      `How did ${firstName}'s call go?`,
      "Mark it done, a no show, or a late cancel in the calendar.",
      "/admin/calendar",
      `outcome-pending-${slot.id}`,
    );

    await supabase
      .from("curriculum_slots")
      .update({ push_outcome_pending_sent_at: new Date().toISOString() })
      .eq("id", slot.id);

    sent++;
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
