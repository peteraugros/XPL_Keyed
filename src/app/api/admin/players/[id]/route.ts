// PATCH /api/admin/players/[id]
//
// Coach-only update of player metadata. Currently scoped to one field:
// discord_channel_url (Tim's manual paste after creating the per-kid
// private channel). Schema design keeps the URL on the player row, so a
// future field (e.g. coach notes) drops in here without route sprawl.
//
// Auth posture: the cookie-bound supabase client is used so RLS applies.
// The players_coach_all policy permits coach UPDATE. A non-coach caller
// would either fail the auth check up front or have the UPDATE refused
// by RLS. We add a defensive is_active coach lookup so a deactivated
// coach can't mutate either.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  discord_channel_url: z
    .string()
    .trim()
    .url()
    .max(2048)
    .nullable(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const playerId = params.id;

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    body = BodySchema.parse({
      discord_channel_url:
        raw && raw.discord_channel_url === "" ? null : raw?.discord_channel_url ?? null,
    });
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

  // Defensive coach check.
  const coachLookup = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // discord_channel_url was added in migration 20260517000700_admin_columns.
  // Until Peter runs `npm run gen:types` against the migrated local DB, the
  // generated Database types don't include it, so we cast the patch through
  // `never` at the boundary. After regen this can become a typed
  // `TablesUpdate<"players">` literal.
  const patch = { discord_channel_url: body.discord_channel_url };
  const result = await supabase
    .from("players")
    .update(patch as never)
    .eq("id", playerId);
  if (result.error) {
    console.error("[admin/players] update failed", result.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
