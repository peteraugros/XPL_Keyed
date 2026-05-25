// POST /api/portal/subscription/acknowledge-uniform-schedule
//
// Stamps uniform_schedule_acknowledged_at on the family's active
// subscription, dismissing the "your sessions are predicted at these
// times" card on /portal without requiring the parent to book each
// slot through Calendly first.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParentLookup = { family_id: string };
type PlayerLookup = { id: string };
type SubLookup = { id: string };

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parentResp = await supabase
    .from("parents")
    .select("family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentResp.data as ParentLookup | null;
  if (!parent) return NextResponse.json({ error: "Not a parent" }, { status: 403 });

  const playerResp = await supabase
    .from("players")
    .select("id")
    .eq("family_id", parent.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const player = playerResp.data as PlayerLookup | null;
  if (!player) return NextResponse.json({ error: "No player" }, { status: 404 });

  const subResp = await supabase
    .from("subscriptions")
    .select("id")
    .eq("player_id", player.id)
    .eq("lifecycle_state" as never, "ACTIVE")
    .maybeSingle();
  const sub = subResp.data as SubLookup | null;
  if (!sub) return NextResponse.json({ error: "No active subscription" }, { status: 404 });

  await supabase
    .from("subscriptions")
    .update({ uniform_schedule_acknowledged_at: new Date().toISOString() } as never)
    .eq("id", sub.id);

  return NextResponse.json({ ok: true });
}
