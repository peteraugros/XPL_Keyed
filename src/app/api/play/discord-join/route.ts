// POST /api/play/discord-join
//
// Trust-based completion marker. After the kid opens Tim's coaching server
// invite and clicks "I'm in the server," we INSERT quest_completions
// (quest_key='join_discord'). No verification — Tim can confirm visually
// in his server.
//
// A real Discord OAuth flow (kid authorizes the app, we check guild
// membership via the Bot's GET /guilds/{id}/members/{user.id}) is the
// upgrade-later path. Out of scope for MVP; the spec accepts trust-based
// here because the call literally happens in Discord — if the kid lies,
// they have no call to attend.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
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

  const questRow: TablesInsert<"quest_completions"> = {
    player_id: player.id,
    quest_key: "join_discord",
  };
  const questInsert = await supabase.from("quest_completions").insert(questRow as never);
  if (questInsert.error) {
    const dup = (questInsert.error.code ?? "") === "23505";
    if (!dup) {
      console.error("[play/discord-join] insert failed", questInsert.error);
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
