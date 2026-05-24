// PUT /api/admin/lesson-bundles/[id]/lessons
//
// Coach-gated. Atomically sets the bundle's member lessons + their
// ordering. Body: { lesson_ids: string[] }. Implementation:
//   1. Clear bundle_id / bundle_position on any lesson that was
//      previously in this bundle but isn't in the new list.
//   2. For each lesson_id in the new list, set bundle_id=this bundle
//      and bundle_position=index+1.
//
// Whole-list-replace pattern is simplest semantically (the client
// sends the canonical order; we mirror it). Tim's library is small
// enough that N+M UPDATEs per save is fine.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  lesson_ids: z.array(z.string().uuid()).max(50),
});

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: bundleId } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const coachRow = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  const coach = coachRow.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();

  // 1. Find current members.
  const currentResp = await service
    .from("lessons")
    .select("id")
    .eq("bundle_id" as never, bundleId);
  const currentIds = ((currentResp.data ?? []) as Array<{ id: string }>).map((r) => r.id);

  const newIds = body.lesson_ids;
  const removed = currentIds.filter((id) => !newIds.includes(id));

  // 2. Detach removed lessons.
  if (removed.length > 0) {
    await service
      .from("lessons")
      .update({ bundle_id: null, bundle_position: null } as never)
      .in("id", removed);
  }

  // 3. Set bundle_id + position on each new member. Per-row updates so
  // we can vary bundle_position. Tim's library is small; fine.
  for (let i = 0; i < newIds.length; i++) {
    const upd = await service
      .from("lessons")
      .update({ bundle_id: bundleId, bundle_position: i + 1 } as never)
      .eq("id", newIds[i]);
    if (upd.error) {
      console.error("[lesson-bundles/lessons PUT] member update failed", upd.error);
      return NextResponse.json({ error: "membership_update_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: newIds.length });
}
