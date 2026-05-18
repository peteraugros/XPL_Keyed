// POST /api/play/vod
//
// The kid pastes a VOD URL on /play. We:
//   1. resolve their player id from the cookie session,
//   2. insert into vod_uploads (source='paste_url', is_initial_trial_vod=true),
//   3. insert into quest_completions(quest_key='drop_vod') with conflict-do-nothing
//      so re-submits don't double-fire the XP.
//
// RLS does the auth check via vod_uploads_kid_insert + quest_completions_kid_insert.
// Both policies use player_id = player_id_for_user(), so a forged player_id in the
// body cannot succeed.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  url: z
    .string()
    .trim()
    .min(8)
    .max(2048)
    .url(),
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

  const playerLookup = await supabase
    .from("players")
    .select("id")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();

  const player = playerLookup.data as { id: string } | null;
  if (!player) {
    return NextResponse.json({ error: "not_a_player" }, { status: 403 });
  }

  const vodRow: TablesInsert<"vod_uploads"> = {
    player_id: player.id,
    source: "paste_url",
    url: body.url,
    is_initial_trial_vod: true,
  };
  const vodInsert = await supabase.from("vod_uploads").insert(vodRow as never);
  if (vodInsert.error) {
    console.error("[play/vod] insert failed", vodInsert.error);
    return NextResponse.json({ error: "vod_insert_failed" }, { status: 500 });
  }

  // quest_completions has UNIQUE (player_id, quest_key). On re-submit we
  // intentionally silently no-op the marker write.
  const questRow: TablesInsert<"quest_completions"> = {
    player_id: player.id,
    quest_key: "drop_vod",
  };
  const questInsert = await supabase.from("quest_completions").insert(questRow as never);
  if (questInsert.error) {
    const dup = (questInsert.error.code ?? "") === "23505";
    if (!dup) {
      console.error("[play/vod] quest insert failed", questInsert.error);
      return NextResponse.json({ error: "quest_insert_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
