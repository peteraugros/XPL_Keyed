// POST /api/play/message
//
// Kid sends a message to Tim from /play. RLS (messages_kid_insert) enforces:
//   - sender_role MUST be 'player'
//   - player_id MUST equal player_id_for_user() (the kid's own player record)
// Both are written server-side anyway so a forged body can't slip past.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
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

  const playerLookup = await supabase
    .from("players")
    .select("id")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const player = playerLookup.data as { id: string } | null;
  if (!player) {
    return NextResponse.json({ error: "not_a_player" }, { status: 403 });
  }

  const row: TablesInsert<"messages"> = {
    player_id: player.id,
    sender_role: "player",
    sender_id: userResult.data.user.id,
    body: parsed.body,
  };
  const insert = await supabase
    .from("messages")
    .insert(row as never)
    .select("id, sender_role, body, created_at")
    .single();

  if (insert.error) {
    console.error("[play/message] insert failed", insert.error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: insert.data });
}
