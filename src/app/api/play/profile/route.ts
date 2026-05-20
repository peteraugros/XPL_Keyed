// POST /api/play/profile — kid edits their own profile.
//
// Auth: cookie-bound supabase.auth.getUser. Must resolve to a player row.
// RLS players_self_update (auth_user_id = auth.uid()) lets the kid's
// cookie client update their own row directly. No service role needed
// here, which is the cleaner posture: the kid has direct authority
// over IGN / Discord / rank / platform / hours.
//
// Locked from kid edit: first_name and age. Those route through Tim or
// the parent (parent's settings page does first_name; age is set at
// intake and rarely changes).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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

const bodySchema = z
  .object({
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

type PlayerLookup = { id: string };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Verify the authed user is a player.
  const playerResp = await supabase
    .from("players")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const player = playerResp.data as PlayerLookup | null;
  if (!player) {
    return NextResponse.json({ error: "not_a_player" }, { status: 403 });
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

  const updates: Record<string, unknown> = {};
  if (body.fortnite_username !== undefined)
    updates.fortnite_username = body.fortnite_username || null;
  if (body.discord_username !== undefined)
    updates.discord_username = body.discord_username || null;
  if (body.current_rank !== undefined) updates.current_rank = body.current_rank || null;
  if (body.platform !== undefined) updates.platform = body.platform || null;
  if (body.hours_per_week !== undefined) updates.hours_per_week = body.hours_per_week;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Cookie-bound write. RLS players_self_update handles authz.
  const upd = await supabase
    .from("players")
    .update(updates as never)
    .eq("id", player.id);
  if (upd.error) {
    console.error("[play/profile] update failed", upd.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
