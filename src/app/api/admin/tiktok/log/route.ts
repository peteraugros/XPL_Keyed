// POST /api/admin/tiktok/log
//
// Tim taps the daily "✓ Commented today" button on his Focused Home
// TikTok reminder. Inserts a tiktok_comments row stamped to today.
// The UNIQUE (coach_id, logged_date) index makes this idempotent for
// the day — a second tap just returns ok.
//
// Optional body: { note: string } — for the future detail-collection
// pass (Peter wants to track parent video, comment text, like count
// once it scales). For MVP, just stamping the day is enough.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export async function POST(req: Request) {
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
  const coach = coachRow.data as { id: string } | null;
  if (!coach) {
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
  const insert = await service
    .from("tiktok_comments")
    .insert({
      coach_id: coach.id,
      note: parsed.note ?? null,
    } as never);
  // Conflict on the unique (coach_id, logged_date) index means Tim
  // already logged today. Treat as success.
  if (insert.error && insert.error.code !== "23505") {
    console.error("[admin/tiktok/log] insert failed", insert.error);
    return NextResponse.json({ error: "log_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
