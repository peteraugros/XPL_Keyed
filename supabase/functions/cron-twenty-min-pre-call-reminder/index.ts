// Edge Function — twenty_min_pre_call_reminder
//
// Fired every minute by pg_cron. Finds calls starting in the 19–21 minute
// window that haven't been pinged yet, DMs Tim with prep context, marks
// `notified_at_20min` so the next firing doesn't double-ping.
//
// This is a stub showing the pattern. Wire to real Discord + DB logic when
// the codebase is hooked up.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN")!;
const DISCORD_TIM_USER_ID = Deno.env.get("DISCORD_TIM_USER_ID")!;

const DISCORD_API = "https://discord.com/api/v10";

async function dmTim(content: string) {
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: DISCORD_TIM_USER_ID }),
  });
  if (!dmRes.ok) throw new Error(`Discord createDM ${dmRes.status}`);
  const { id: channelId } = await dmRes.json();

  const msgRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  if (!msgRes.ok) throw new Error(`Discord send ${msgRes.status}`);
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Window: 19–21 minutes from now. pg_cron fires every minute, so any given
  // call enters this window for ~2 firings — `notified_at_20min IS NULL`
  // prevents duplicate DMs.
  const lowerMinutes = 19;
  const upperMinutes = 21;

  const now = new Date();
  const lower = new Date(now.getTime() + lowerMinutes * 60_000).toISOString();
  const upper = new Date(now.getTime() + upperMinutes * 60_000).toISOString();

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
    // TODO: enrich with prep-completion stats, VOD link, channel link.
    // deno-lint-ignore no-explicit-any
    const player = (slot as any).curricula?.players;
    const firstName = player?.first_name ?? "Unknown";
    await dmTim(`Call with ${firstName} starts in 20 minutes.`);

    await supabase
      .from("curriculum_slots")
      .update({ notified_at_20min: new Date().toISOString() })
      .eq("id", slot.id);
  }

  return new Response(JSON.stringify({ notified: slots.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
