// POST /api/portal/subscription/reenable-auto-renew
//
// Parent changed their mind during the current cycle. Flips
// auto_renew_enabled back to TRUE so the next-cycle PaymentIntent will
// fire when the cycle wraps. Only valid while the subscription is
// still 'active' — once the cycle ends and the subscription is
// 'canceled', the parent has to go through the normal restart flow.
//
// Idempotent.

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
      { error: "subscription_already_ended", status: sub.status },
      { status: 400 },
    );
  }

  if (sub.auto_renew_enabled) {
    return NextResponse.json({ ok: true, auto_renew_enabled: true });
  }

  const upd = await service
    .from("subscriptions")
    .update({ auto_renew_enabled: true, auto_renew_off_acknowledged_at: null } as never)
    .eq("id", sub.id);
  if (upd.error) {
    console.error("[portal/subscription/reenable-auto-renew] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, auto_renew_enabled: true });
}
