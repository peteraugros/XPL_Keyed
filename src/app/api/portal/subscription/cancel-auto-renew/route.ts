// POST /api/portal/subscription/cancel-auto-renew
//
// Parent-initiated cancel. Flips auto_renew_enabled=FALSE on the
// family's subscription. Current cycle continues to lesson 4 normally;
// the next-cycle PaymentIntent will NOT fire, and the cron-auto-renew-
// detection job will transition the subscription to canceled when the
// current cycle wraps.
//
// We don't use Stripe Subscription objects (our model is one-time
// PaymentIntents off the saved card + a manually-advanced cycle), so
// there's no Stripe-side cancel to coordinate. This endpoint is the
// canonical cancel path for active subscriptions.
//
// Idempotent: if auto_renew_enabled is already FALSE, returns ok.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParentLookup = { family_id: string };
type PlayerLookup = { id: string; family_id: string };
type SubLookup = {
  id: string;
  status: string;
  auto_renew_enabled: boolean;
};

export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parentRow = await supabase
    .from("parents")
    .select("family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;
  if (!parent) return NextResponse.json({ error: "not_a_parent" }, { status: 403 });

  const service = createServiceRoleClient();

  // Find the family's player (single-kid MVP — picks the first).
  const playerRow = await service
    .from("players")
    .select("id, family_id")
    .eq("family_id", parent.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const player = playerRow.data as PlayerLookup | null;
  if (!player) return NextResponse.json({ error: "no_player" }, { status: 404 });

  const subRow = await service
    .from("subscriptions")
    .select("id, status, auto_renew_enabled")
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subRow.data as SubLookup | null;
  if (!sub) return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });

  if (sub.status !== "active") {
    return NextResponse.json(
      { error: "not_active", status: sub.status },
      { status: 400 },
    );
  }

  if (!sub.auto_renew_enabled) {
    // Already off — idempotent success.
    return NextResponse.json({ ok: true, auto_renew_enabled: false });
  }

  const upd = await service
    .from("subscriptions")
    .update({ auto_renew_enabled: false } as never)
    .eq("id", sub.id);
  if (upd.error) {
    console.error("[portal/subscription/cancel-auto-renew] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, auto_renew_enabled: false });
}
