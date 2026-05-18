// POST /api/play/prep
//
// The kid submits the Stage B prep questions (Q1 + Q2 single-select + Q3
// free text). One row per player in prep_responses (UNIQUE(player_id)).
// MVP is one-shot: kid can't re-submit. If they really need to change an
// answer, Tim can ask in the call.
//
// We also write quest_completions(quest_key='answer_questions'). RLS does
// the auth check (prep_responses_kid_insert + quest_completions_kid_insert).
//
// Quest sequencing — Q3's prompt depends on the VOD already being uploaded.
// The /play UI enforces the gate, but we ALSO enforce it server-side so a
// race or a hand-crafted POST can't slip past: the route refuses to write
// if `drop_vod` is not already a completed quest for the player.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q1_SLUGS = [
  "lose_fights",
  "build_slow",
  "third_partied",
  "tilt",
  "stuck_rank",
  "streamer_gap",
  "other",
] as const;

const Q2_SLUGS = [
  "stop_dying",
  "beat_friends",
  "hit_unreal",
  "top_10k_cashcup",
  "fncs",
  "prize_money",
  "other",
] as const;

const BodySchema = z.object({
  q1_choice: z.enum(Q1_SLUGS),
  q1_other_text: z.string().trim().max(280).nullable().optional(),
  q2_choice: z.enum(Q2_SLUGS),
  q2_other_text: z.string().trim().max(280).nullable().optional(),
  q3_reflection: z.string().trim().min(1).max(2000),
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
  if (body.q1_choice === "other" && !body.q1_other_text)
    return NextResponse.json({ error: "q1_other_required" }, { status: 400 });
  if (body.q2_choice === "other" && !body.q2_other_text)
    return NextResponse.json({ error: "q2_other_required" }, { status: 400 });

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

  // Server-side sequencing: the prep questions can't be submitted until
  // the VOD quest is complete. UI gates this too, but the server is the
  // source of truth.
  const vodQuestLookup = await supabase
    .from("quest_completions")
    .select("quest_key")
    .eq("player_id", player.id)
    .eq("quest_key", "drop_vod")
    .maybeSingle();
  if (!vodQuestLookup.data) {
    return NextResponse.json({ error: "vod_required_first" }, { status: 409 });
  }

  const prepRow: TablesInsert<"prep_responses"> = {
    player_id: player.id,
    q1_choice: body.q1_choice,
    q1_other_text: body.q1_choice === "other" ? body.q1_other_text ?? null : null,
    q2_choice: body.q2_choice,
    q2_other_text: body.q2_choice === "other" ? body.q2_other_text ?? null : null,
    q3_reflection: body.q3_reflection,
  };
  const prepInsert = await supabase.from("prep_responses").insert(prepRow as never);
  if (prepInsert.error) {
    const dup = (prepInsert.error.code ?? "") === "23505";
    if (dup) {
      return NextResponse.json({ error: "already_submitted" }, { status: 409 });
    }
    console.error("[play/prep] insert failed", prepInsert.error);
    return NextResponse.json({ error: "prep_insert_failed" }, { status: 500 });
  }

  const questRow: TablesInsert<"quest_completions"> = {
    player_id: player.id,
    quest_key: "answer_questions",
  };
  const questInsert = await supabase.from("quest_completions").insert(questRow as never);
  if (questInsert.error) {
    const dup = (questInsert.error.code ?? "") === "23505";
    if (!dup) {
      console.error("[play/prep] quest insert failed", questInsert.error);
      return NextResponse.json({ error: "quest_insert_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
