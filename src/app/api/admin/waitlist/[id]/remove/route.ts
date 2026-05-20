// POST /api/admin/waitlist/[id]/remove
//
// Coach-gated. Marks a waitlist entry as removed with an internal note.
// Used for bad contact info, families who reached out separately, or
// any case where Tim wants the family off the FIFO queue without going
// through the regular freshness-check timeout.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    reason: z.string().trim().max(200).optional(),
  })
  .strict();

export async function POST(
  req: Request,
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

  let parsed: z.infer<typeof bodySchema> = {};
  try {
    const text = await req.text();
    if (text) parsed = bodySchema.parse(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const upd = await service
    .from("waitlist_entries")
    .update({
      status: "removed",
      removed_at: new Date().toISOString(),
      removed_reason: parsed.reason ?? "removed_by_coach",
    } as never)
    .eq("id", id);
  if (upd.error) {
    console.error("[admin/waitlist/remove] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
