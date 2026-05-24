// POST /api/admin/lesson-bundles
//
// Coach-gated. Creates a new lesson bundle (Tim's named collection
// of lessons). Body: { title, description? }. Returns { ok, id }.
// /admin/lessons?tab=bundles uses this to spawn a fresh bundle from
// the inline "New bundle" form.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request) {
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
  // lesson_bundles table was added by 20260524000200_lesson_bundles.sql
  // and isn't in db.ts yet (next gen:types run will tighten this).
  // Cast through `as never` for the table name + select args; the runtime
  // shape is correct.
  const insert = await (service.from("lesson_bundles" as never) as unknown as {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> };
    };
  })
    .insert({
      author_id: coach.id,
      title: body.title,
      description: body.description ?? null,
      is_published: false,
    })
    .select("id")
    .single();

  if (insert.error || !insert.data) {
    console.error("[lesson-bundles/POST] insert failed", insert.error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: insert.data.id });
}
