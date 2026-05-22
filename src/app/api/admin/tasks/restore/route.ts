// POST /api/admin/tasks/restore
//
// Reverses a dismiss. The (task_type, source_object_id) pair is moved
// from "actively dismissed" back into the live queue by stamping
// restored_at + restored_by on the active dismissal row. The row stays
// in the table for audit history; a future re-dismiss is allowed
// because the partial unique index only enforces uniqueness on rows
// where restored_at IS NULL.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  task_type: z.string().trim().min(1).max(64),
  source_object_id: z.string().uuid(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const coachLookup = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = await supabase
    .from("task_dismissals")
    .update({
      restored_at: new Date().toISOString(),
      restored_by: coach.id,
    } as never)
    .eq("task_type", body.task_type)
    .eq("source_object_id", body.source_object_id)
    .is("restored_at", null);

  if (update.error) {
    console.error("[admin/tasks/restore] update failed", update.error);
    return NextResponse.json({ error: "restore_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
