// POST /api/portal/settings — partial update of parent + player profile
// fields from /portal/settings.
//
// Auth: cookie-bound supabase.auth.getUser. Reject if not a parent.
// Authorization: the player_id in the body must belong to the parent's
//   family. We verify via a SELECT through the cookie client (which
//   enforces family_id_for_user() RLS) before writing.
//
// Writes:
//   * parents.first_name — through cookie client (parents_self_update
//     RLS grants this on auth_user_id match).
//   * players.* — through the service role client. RLS's
//     players_self_update is keyed on the player's own auth_user_id,
//     not the parent's, so the cookie client can't UPDATE these. The
//     route still scopes the write to the family it just verified.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const RANKS = new Set([
  "Not ranked yet",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Elite",
  "Champion",
  "Unreal",
]);
const PLATFORMS = new Set(["PC", "PlayStation", "Xbox", "Switch", "Mobile"]);

const parentSchema = z
  .object({
    first_name: z.string().trim().min(1).max(80),
  })
  .strict();

const playerSchema = z
  .object({
    id: z.string().uuid(),
    first_name: z.string().trim().min(1).max(80).optional(),
    fortnite_username: z.string().trim().max(64).nullable().optional(),
    discord_username: z.string().trim().max(64).nullable().optional(),
    current_rank: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || RANKS.has(v), { message: "invalid_rank" }),
    platform: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || PLATFORMS.has(v), { message: "invalid_platform" }),
    hours_per_week: z.number().min(0).max(168).nullable().optional(),
  })
  .strict();

const bodySchema = z
  .object({
    parent: parentSchema.optional(),
    player: playerSchema.optional(),
  })
  .refine((b) => !!b.parent || !!b.player, { message: "nothing_to_update" });

type ParentLookup = { id: string; family_id: string };
type PlayerLookup = { id: string };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    body = bodySchema.parse(json);
  } catch (err) {
    const msg =
      err instanceof z.ZodError ? err.issues[0]?.message ?? "invalid_body" : "invalid_body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Verify the authed user is a parent.
  const parentResp = await supabase
    .from("parents")
    .select("id, family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentResp.data as ParentLookup | null;
  if (!parent) {
    return NextResponse.json({ error: "not_a_parent" }, { status: 403 });
  }

  // Update parent.first_name via the cookie client (RLS allows).
  if (body.parent) {
    const upd = await supabase
      .from("parents")
      .update({ first_name: body.parent.first_name } as never)
      .eq("auth_user_id", user.id);
    if (upd.error) {
      console.error("[portal/settings] parent update failed", upd.error);
      return NextResponse.json({ error: "parent_update_failed" }, { status: 500 });
    }
  }

  // Update player fields. The cookie client can SELECT but not UPDATE the
  // player row (RLS keyed on the player's auth_user_id). Verify family
  // scope through the cookie client first, then write through the
  // service role client.
  if (body.player) {
    const verify = await supabase
      .from("players")
      .select("id")
      .eq("id", body.player.id)
      .eq("family_id", parent.family_id)
      .maybeSingle();
    const ok = verify.data as PlayerLookup | null;
    if (!ok) {
      return NextResponse.json({ error: "player_not_in_family" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (body.player.first_name !== undefined) updates.first_name = body.player.first_name;
    if (body.player.fortnite_username !== undefined)
      updates.fortnite_username = body.player.fortnite_username || null;
    if (body.player.discord_username !== undefined)
      updates.discord_username = body.player.discord_username || null;
    if (body.player.current_rank !== undefined)
      updates.current_rank = body.player.current_rank || null;
    if (body.player.platform !== undefined) updates.platform = body.player.platform || null;
    if (body.player.hours_per_week !== undefined)
      updates.hours_per_week = body.player.hours_per_week;

    if (Object.keys(updates).length > 0) {
      const service = createServiceRoleClient();
      const upd = await service
        .from("players")
        .update(updates as never)
        .eq("id", body.player.id);
      if (upd.error) {
        console.error("[portal/settings] player update failed", upd.error);
        return NextResponse.json({ error: "player_update_failed" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
