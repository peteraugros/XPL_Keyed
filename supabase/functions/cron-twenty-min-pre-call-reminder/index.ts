// Edge Function — cron-twenty-min-pre-call-reminder
//
// Fired every minute by pg_cron. Finds calls starting in the 19 to 21 minute
// window that have not been pinged yet, sends Tim a web push notification,
// then marks notified_at_20min so the next firing does not double ping.
//
// Replaces the original Discord DM approach (retired per feedback_no_discord_dms).
// All operator notifications surface in app and via web push only.

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

async function sendPushToActiveCoach(
  supabase: ReturnType<typeof createClient>,
  title: string,
  body: string,
  url: string,
  tag: string,
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.warn("[push] VAPID keys not configured");
    return;
  }

  // Tim is the only active non-dad coach in MVP.
  const { data: coach } = await supabase
    .from("coaches")
    .select("id")
    .eq("is_active", true)
    .eq("is_dad", false)
    .limit(1)
    .maybeSingle();
  if (!coach) return;

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("coach_id", (coach as { id: string }).id);
  if (!subs?.length) return;

  const payload = JSON.stringify({ title, body, url, tag });
  const expired: string[] = [];

  await Promise.allSettled(
    (subs as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>).map(
      async (sub) => {
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
      },
    ),
  );

  if (expired.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expired);
  }
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Window: 19 to 21 minutes from now. pg_cron fires every minute, so any
  // given call enters this window for about 2 firings. notified_at_20min
  // prevents duplicate pushes.
  const now = new Date();
  const lower = new Date(now.getTime() + 19 * 60_000).toISOString();
  const upper = new Date(now.getTime() + 21 * 60_000).toISOString();

  const { data: slots, error } = await supabase
    .from("curriculum_slots")
    .select(
      "id, live_call_at, curriculum_id, curricula(player_id, players(first_name))",
    )
    .gte("live_call_at", lower)
    .lte("live_call_at", upper)
    .is("notified_at_20min", null)
    .is("live_call_completed_at", null);

  if (error) return new Response(error.message, { status: 500 });
  if (!slots?.length) return new Response("no_slots", { status: 200 });

  for (const slot of slots) {
    // deno-lint-ignore no-explicit-any
    const player = (slot as any).curricula?.players;
    const firstName = player?.first_name ?? "Unknown";

    await sendPushToActiveCoach(
      supabase,
      `${firstName}'s lesson in 20 min`,
      "Open the calendar to review prep.",
      "/admin/calendar",
      `pre-call-${slot.id}`,
    );

    await supabase
      .from("curriculum_slots")
      .update({ notified_at_20min: new Date().toISOString() })
      .eq("id", slot.id);
  }

  return new Response(JSON.stringify({ notified: slots.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
