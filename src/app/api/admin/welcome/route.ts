// POST /api/admin/welcome
//
// Tim taps "I welcomed them" on the Focused Home welcome card. This:
//   1. Writes the optional welcome message to /play/squad thread
//      (sender_role='coach', waiting_on='KID' so the kid sees it).
//   2. Updates the kid's discord_channel_url if a new value was provided.
//   3. Stamps subscriptions.welcomed_at + subscriptions.coach_seen_at.
//   4. Flips waiting_on='SYSTEM' → welcome task drops off Focused Home
//      via derived_tasks_view.
//   5. Logs a task_completion for the "X done today" streak.
//
// Coach-gated. Subscription is identified by subscription_id in the
// body (passed from the welcome card).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    subscription_id: z.string().uuid(),
    welcome_message: z.string().trim().max(2000).optional(),
    discord_channel_url: z.string().trim().max(500).optional(),
  })
  .strict();

type SubscriptionLookup = {
  id: string;
  player_id: string;
  welcomed_at: string | null;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const coachRow = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  const coach = coachRow.data as { id: string } | null;
  if (!coach) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();

  const subResp = await service
    .from("subscriptions")
    .select("id, player_id, welcomed_at")
    .eq("id", body.subscription_id)
    .maybeSingle();
  const sub = subResp.data as SubscriptionLookup | null;
  if (!sub) {
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }
  // Idempotent: if already welcomed, just return ok.
  if (sub.welcomed_at) {
    return NextResponse.json({ ok: true, already_welcomed: true });
  }

  const stamp = new Date().toISOString();

  // 1. Welcome message (if Tim typed one).
  if (body.welcome_message && body.welcome_message.length > 0) {
    const msgInsert = await service
      .from("messages")
      .insert({
        player_id: sub.player_id,
        sender_role: "coach",
        sender_id: coach.id,
        body: body.welcome_message,
        waiting_on: "KID",
      } as never);
    if (msgInsert.error) {
      console.error("[admin/welcome] message insert failed", msgInsert.error);
      // Non-fatal — still mark welcomed so the task drops.
    }
  }

  // 2. Discord channel URL (if Tim provided one).
  if (body.discord_channel_url && body.discord_channel_url.length > 0) {
    const playerUpd = await service
      .from("players")
      .update({ discord_channel_url: body.discord_channel_url } as never)
      .eq("id", sub.player_id);
    if (playerUpd.error) {
      console.error("[admin/welcome] discord_channel_url update failed", playerUpd.error);
      // Non-fatal.
    }
  }

  // 3 + 4. Stamp welcomed_at + flip waiting_on → drops the task.
  const subUpd = await service
    .from("subscriptions")
    .update({
      welcomed_at: stamp,
      coach_seen_at: stamp,
      waiting_on: "SYSTEM",
    } as never)
    .eq("id", sub.id);
  if (subUpd.error) {
    console.error("[admin/welcome] subscription update failed", subUpd.error);
    return NextResponse.json({ error: "welcome_update_failed" }, { status: 500 });
  }

  // 5. Audit row for the "X done today" counter. The trigger that
  // normally writes this fires on waiting_on TIM→ANY transitions, so
  // step 4 above usually already triggered it; the explicit insert here
  // is belt-and-suspenders.
  await service
    .from("task_completions")
    .insert({
      coach_id: coach.id,
      source_table: "subscriptions",
      source_id: sub.id,
    } as never);

  return NextResponse.json({ ok: true });
}
