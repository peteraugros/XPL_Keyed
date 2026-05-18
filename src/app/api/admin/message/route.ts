// POST /api/admin/message
//
// Tim sends a message to a kid from /admin. RLS (messages_coach_all)
// permits coach writes to any player. We still validate that the auth'd
// user has an active coach row before letting the insert run — RLS would
// catch it, but a defensive 403 makes the failure mode obvious.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  player_id: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
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

  // waiting_on='KID' per backend-spec section 2: Tim sends a message to
  // the kid (our schema's only message recipient today), so the thread
  // now waits on the kid.
  const row: TablesInsert<"messages"> = {
    player_id: parsed.player_id,
    sender_role: "coach",
    sender_id: coach.id,
    body: parsed.body,
    waiting_on: "KID",
  };
  const insert = await supabase
    .from("messages")
    .insert(row as never)
    .select("id, sender_role, body, created_at")
    .single();

  if (insert.error) {
    console.error("[admin/message] insert failed", insert.error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: insert.data });
}
