// Edge Function — day7_dunning_ping
//
// Fired daily at 14:00 UTC by pg_cron. Per CLAUDE.md "Dunning & failed payment":
// at Day 7 of past_due, Tim gets a Discord DM so he can reach out personally
// in the family's private channel before the auto-end at Day 14.
//
// Idempotency: subscriptions.notified_at_day7_dunning.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dmTim } from "../_shared/discord.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN")!;
const DISCORD_TIM_USER_ID = Deno.env.get("DISCORD_TIM_USER_ID")!;

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 7 days ago. Anything past_due since at or before this time is eligible.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("id, player_id, past_due_started_at, players(first_name)")
    .eq("status", "past_due")
    .lte("past_due_started_at", sevenDaysAgo)
    .is("notified_at_day7_dunning", null);

  if (error) return new Response(error.message, { status: 500 });
  if (!subs?.length) return new Response("no_subs", { status: 200 });

  for (const sub of subs) {
    // deno-lint-ignore no-explicit-any
    const firstName = (sub as any).players?.first_name ?? "A family";
    await dmTim(
      DISCORD_BOT_TOKEN,
      DISCORD_TIM_USER_ID,
      `${firstName}'s family. Payment failing 7 days. Want to reach out personally?`,
    );

    await supabase
      .from("subscriptions")
      .update({ notified_at_day7_dunning: new Date().toISOString() })
      .eq("id", sub.id);
  }

  return new Response(JSON.stringify({ notified: subs.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
