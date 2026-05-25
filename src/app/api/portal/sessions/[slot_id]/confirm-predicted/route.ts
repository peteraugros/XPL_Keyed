// POST /api/portal/sessions/[slot_id]/confirm-predicted
//
// Called when a parent books a uniform-predicted slot through the Calendly
// embed in ConfirmPredictedModal. The slot already has a predicted live_call_at
// (set by provisionNextCycle) but no live_call_event_id.
//
// Unlike /reschedule, this is a first-time booking — no existing Calendly
// event to cancel, no 24hr rule, no skip counter touch.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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
  live_call_completed_at: string | null;
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
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify caller is a parent.
  const parentResp = await supabase
    .from("parents")
    .select("family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentResp.data as ParentLookup | null;
  if (!parent) return NextResponse.json({ error: "Not a parent" }, { status: 403 });

  // Load the slot and verify it belongs to this family.
  const slotResp = await supabase
    .from("curriculum_slots")
    .select("id, curriculum_id, live_call_at, live_call_event_id, live_call_completed_at")
    .eq("id", slot_id)
    .maybeSingle();
  const slot = slotResp.data as SlotLookup | null;
  if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });

  if (slot.live_call_completed_at) {
    return NextResponse.json({ error: "Slot already completed" }, { status: 409 });
  }
  if (slot.live_call_event_id) {
    return NextResponse.json({ error: "Slot already has a Calendly event" }, { status: 409 });
  }

  const curriculumResp = await supabase
    .from("curricula")
    .select("id, player_id")
    .eq("id", slot.curriculum_id)
    .maybeSingle();
  const curriculum = curriculumResp.data as CurriculumLookup | null;
  if (!curriculum) return NextResponse.json({ error: "Curriculum not found" }, { status: 404 });

  const playerResp = await supabase
    .from("players")
    .select("id, family_id")
    .eq("id", curriculum.player_id)
    .maybeSingle();
  const player = playerResp.data as PlayerLookup | null;
  if (!player || player.family_id !== parent.family_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await supabase
    .from("curriculum_slots")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      live_call_at: body.new_time_iso,
      live_call_event_id: body.new_event_uri,
    } as never)
    .eq("id", slot_id);

  return NextResponse.json({ ok: true });
}
