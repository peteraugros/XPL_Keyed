// POST /api/messages/mark-read
//
// Body: { player_id, viewer_role: 'recipient' | 'parent' }
//
// Stamps the appropriate read column on every unread message in the
// player's thread:
//   * viewer_role='recipient' → stamps read_by_recipient_at on
//     messages where the viewer ISN'T the sender (i.e., kid reads
//     coach messages and vice versa; the "recipient" is whoever was
//     supposed to read it)
//   * viewer_role='parent' → stamps read_by_parent_at on every message
//     (parent has read-only audit access to the full thread)
//
// Auth gate: the viewer must own the thread:
//   * Player path: auth_user_id resolves to a player, and that player's
//     id matches player_id.
//   * Coach path (the "recipient" when the kid sent): auth_user_id
//     resolves to a coach.
//   * Parent path: auth_user_id resolves to a parent, and that parent's
//     family_id matches the player's family_id.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    player_id: z.string().uuid(),
    viewer_role: z.enum(["recipient", "parent"]),
  })
  .strict();

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Verify the viewer owns access to this thread.
  // We check player + parent + coach in parallel; auth is established
  // if any one matches the role-appropriate gate.
  const service = createServiceRoleClient();
  const [playerLookup, parentLookup, coachLookup] = await Promise.all([
    service.from("players").select("id, family_id").eq("auth_user_id", userData.user.id).maybeSingle(),
    service.from("parents").select("family_id").eq("auth_user_id", userData.user.id).maybeSingle(),
    service.from("coaches").select("id, is_active").eq("auth_user_id", userData.user.id).maybeSingle(),
  ]);
  const player = playerLookup.data as { id: string; family_id: string } | null;
  const parent = parentLookup.data as { family_id: string } | null;
  const coach = coachLookup.data as { id: string; is_active: boolean } | null;

  // Resolve the player's family_id to gate parent + viewer-role logic.
  const targetPlayer = await service
    .from("players")
    .select("family_id")
    .eq("id", body.player_id)
    .maybeSingle();
  const targetFamily =
    (targetPlayer.data as { family_id: string } | null)?.family_id ?? null;
  if (!targetFamily) {
    return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  }

  if (body.viewer_role === "parent") {
    if (!parent || parent.family_id !== targetFamily) {
      return NextResponse.json({ error: "not_parent_of_player" }, { status: 403 });
    }
    const upd = await service
      .from("messages")
      .update({ read_by_parent_at: new Date().toISOString() } as never)
      .eq("player_id", body.player_id)
      .is("read_by_parent_at", null);
    if (upd.error) {
      console.error("[messages/mark-read:parent] update failed", upd.error);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // viewer_role='recipient' — either the kid reading coach/bot messages,
  // or the coach reading kid messages. We always mark "messages not sent
  // by this viewer" as read.
  let viewerRoleAsSender: "coach" | "player" | null = null;
  if (player && player.id === body.player_id) {
    viewerRoleAsSender = "player";
  } else if (coach && coach.is_active) {
    viewerRoleAsSender = "coach";
  } else {
    return NextResponse.json({ error: "no_thread_access" }, { status: 403 });
  }

  const upd = await service
    .from("messages")
    .update({ read_by_recipient_at: new Date().toISOString() } as never)
    .eq("player_id", body.player_id)
    .neq("sender_role", viewerRoleAsSender)
    .is("read_by_recipient_at", null);
  if (upd.error) {
    console.error("[messages/mark-read:recipient] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
