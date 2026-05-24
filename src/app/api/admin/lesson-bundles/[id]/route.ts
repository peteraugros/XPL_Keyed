// PATCH /api/admin/lesson-bundles/[id]
// DELETE /api/admin/lesson-bundles/[id]
//
// Coach-gated. PATCH supports partial updates of title/description/
// is_published. Deleting a bundle does NOT cascade delete its
// lessons (FK is ON DELETE SET NULL); lessons become unbundled.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  is_published: z.boolean().optional(),
});

async function gateCoach(req: Request) {
  void req;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }
  const coachRow = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  const coach = coachRow.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return { ok: false as const, status: 403, error: "not_a_coach" };
  }
  return { ok: true as const, coach };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await gateCoach(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const service = createServiceRoleClient();
  const upd = await service
    .from("lesson_bundles" as never)
    .update(patch as never)
    .eq("id", id);
  if (upd.error) {
    console.error("[lesson-bundles/PATCH] failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await gateCoach(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const service = createServiceRoleClient();
  const del = await service.from("lesson_bundles" as never).delete().eq("id", id);
  if (del.error) {
    console.error("[lesson-bundles/DELETE] failed", del.error);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
