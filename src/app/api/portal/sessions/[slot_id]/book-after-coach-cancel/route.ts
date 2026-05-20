// POST /api/portal/sessions/[slot_id]/book-after-coach-cancel
//
// Parent picks a new time for a slot Tim cancelled. Different shape
// from the regular reschedule endpoint:
//   * No 24hr check (the original time is gone; the slot has no
//     live_call_at)
//   * No 7-day delta math (no original time to compare against)
//   * No skip counter increment (Tim caused this; not the family's
//     responsibility)
//
// Pre-conditions enforced server-side:
//   * Slot must belong to the parent's family
//   * Slot must be in "cancelled by coach" state — live_call_at IS NULL
//     AND live_call_event_id starts with 'cancelled:'

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    new_event_uri: z.string().url(),
    new_time_iso: z.string().datetime(),
  })
  .strict();

type SlotLookup = {
  id: string;
  curriculum_id: string;
  live_call_at: string | null;
  live_call_event_id: string | null;
};
type CurriculumLookup = { id: string; player_id: string };
type PlayerLookup = { id: string; family_id: string };
type ParentLookup = { family_id: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slot_id: string }> },
) {
  const { slot_id } = await ctx.params;

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

  const parentRow = await supabase
    .from("parents")
    .select("family_id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;
  if (!parent) return NextResponse.json({ error: "not_a_parent" }, { status: 403 });

  const service = createServiceRoleClient();

  const slotRow = await service
    .from("curriculum_slots")
    .select("id, curriculum_id, live_call_at, live_call_event_id")
    .eq("id", slot_id)
    .maybeSingle();
  const slot = slotRow.data as SlotLookup | null;
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 });

  // Slot must be in coach-cancelled state.
  const isCancelledState =
    slot.live_call_at === null &&
    (slot.live_call_event_id ?? "").startsWith("cancelled:");
  if (!isCancelledState) {
    return NextResponse.json(
      { error: "slot_not_in_coach_cancel_state" },
      { status: 400 },
    );
  }

  const curriculumRow = await service
    .from("curricula")
    .select("id, player_id")
    .eq("id", slot.curriculum_id)
    .maybeSingle();
  const curriculum = curriculumRow.data as CurriculumLookup | null;
  if (!curriculum) {
    return NextResponse.json({ error: "curriculum_not_found" }, { status: 404 });
  }

  const playerRow = await service
    .from("players")
    .select("id, family_id")
    .eq("id", curriculum.player_id)
    .maybeSingle();
  const player = playerRow.data as PlayerLookup | null;
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  if (player.family_id !== parent.family_id) {
    return NextResponse.json({ error: "wrong_family" }, { status: 403 });
  }

  const upd = await service
    .from("curriculum_slots")
    .update({
      live_call_at: new Date(body.new_time_iso).toISOString(),
      live_call_event_id: body.new_event_uri,
    } as never)
    .eq("id", slot.id);
  if (upd.error) {
    console.error("[portal/sessions/book-after-coach-cancel] update failed", upd.error);
    return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
