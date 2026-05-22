// POST /api/admin/tasks/dismiss
//
// Operator clears a task from the queue without resolving the underlying
// state. Distinct from completion (which flips waiting_on / lifecycle).
// Dismissals are revocable via /api/admin/tasks/restore.
//
// What this does:
//   1. Inserts a task_dismissals row keyed by (task_type, source_object_id).
//      A partial unique index prevents double-dismiss.
//   2. The /admin page filters its derived_tasks_view query against this
//      table, so the task disappears from Focused Home + expanded stack
//      immediately on next render.
//
// Why app-side filter instead of view-side: keeps derived_tasks_view
// itself untouched, so future view migrations don't have to thread a
// wrapper. The trade-off is the /admin server fetch carries one extra
// LEFT JOIN, which is trivial at our scale.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  task_type: z.string().trim().min(1).max(64),
  source_object_id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
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

  const insert = await supabase.from("task_dismissals").insert({
    task_type: body.task_type,
    source_object_id: body.source_object_id,
    dismissed_by: coach.id,
    dismiss_reason: body.reason ?? null,
  } as never);

  if (insert.error) {
    // Unique violation (already dismissed) is idempotent success from
    // the caller's POV. Postgres 23505 = unique_violation.
    const code = (insert.error as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({ ok: true, already_dismissed: true });
    }
    console.error("[admin/tasks/dismiss] insert failed", insert.error);
    return NextResponse.json({ error: "dismiss_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
