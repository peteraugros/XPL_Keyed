// POST /api/admin/subscriptions/[id]/re-enable-auto-renew
//
// Coach override per the reschedule spec. Flips auto_renew_enabled back
// to TRUE and resets cycle_skips_used to 0. Clears the awareness card
// marker so it drops off Tim's queue. Used when Tim wants to short-
// circuit the 3-strikes rule for a family he believes in.
//
// Coach-gated. Idempotent.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubLookup = {
  id: string;
  auto_renew_enabled: boolean;
  cycle_skips_used: number;
};

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const coachRow = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!coachRow.data) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  const service = createServiceRoleClient();
  const subResp = await service
    .from("subscriptions")
    .select("id, auto_renew_enabled, cycle_skips_used")
    .eq("id", id)
    .maybeSingle();
  const sub = subResp.data as SubLookup | null;
  if (!sub) {
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }

  const upd = await service
    .from("subscriptions")
    .update({
      auto_renew_enabled: true,
      cycle_skips_used: 0,
      cycle_cancels_used: 0,
      auto_renew_off_acknowledged_at: null,
    } as never)
    .eq("id", sub.id);
  if (upd.error) {
    console.error("[admin/re-enable-auto-renew] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
