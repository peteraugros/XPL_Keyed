// POST /api/admin/subscriptions/[id]/ack-auto-renew-off
//
// Tim taps "Got it" on the auto-renew-off awareness card. We stamp
// subscriptions.auto_renew_off_acknowledged_at so the card drops out
// of derived_tasks_view. Does NOT flip auto_renew_enabled — that's
// the separate Re-enable endpoint.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const coachRow = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!coachRow.data) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  const service = createServiceRoleClient();
  const upd = await service
    .from("subscriptions")
    .update({ auto_renew_off_acknowledged_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (upd.error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
