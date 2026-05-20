// POST /api/portal/sessions/auto-book
//
// One-click bulk booking: parent has already booked Week 1 via Calendly
// (so cycle_anchor_at is set). This endpoint computes the matching
// datetime for every remaining pending slot (anchor + (week-1)*7d) and
// writes them directly to curriculum_slots.live_call_at.
//
// Calendly is NOT involved for the auto-booked slots. Their
// live_call_event_id uses the `auto:<slot_id>` sentinel so downstream
// code (cancel/reschedule webhook, admin views) can identify them as
// non-Calendly bookings. Tim's calendar won't have the events; his
// admin shows the dates from the DB. (Future enhancement: ICS file
// attached to a notify-Tim email so he can add to Google Calendar.)
//
// On success, transitions subscription to PENDING_PAYMENT so /portal/sessions
// renders PaymentSummary on the next page load.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParentLookup = { id: string; family_id: string };
type CurriculumLookup = {
  id: string;
  cycle_anchor_at: string | null;
  player_id: string;
};
type PlayerLookup = { id: string; family_id: string };
type SlotLookup = {
  id: string;
  week_number: number;
  live_call_at: string | null;
};
type SubLookup = { id: string; lifecycle_state: string };

export async function POST(_req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parentRow = await supabase
    .from("parents")
    .select("id, family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;
  if (!parent) {
    return NextResponse.json({ error: "not_a_parent" }, { status: 403 });
  }

  const service = createServiceRoleClient();

  // Find the family's oldest player + their active curriculum.
  const playerRow = await service
    .from("players")
    .select("id, family_id")
    .eq("family_id", parent.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const player = playerRow.data as PlayerLookup | null;
  if (!player) {
    return NextResponse.json({ error: "no_player" }, { status: 404 });
  }

  const curriculumRow = await service
    .from("curricula")
    .select("id, cycle_anchor_at, player_id")
    .eq("player_id", player.id)
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curriculum = curriculumRow.data as CurriculumLookup | null;
  if (!curriculum) {
    return NextResponse.json({ error: "no_pending_curriculum" }, { status: 404 });
  }
  if (!curriculum.cycle_anchor_at) {
    // Anchor is set when Week 1 lands. If it's null, the parent hasn't
    // booked the first slot yet; auto-book has no anchor to project from.
    return NextResponse.json(
      { error: "no_cycle_anchor", hint: "Book Week 1 first." },
      { status: 409 },
    );
  }

  const subRow = await service
    .from("subscriptions")
    .select("id, lifecycle_state")
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subRow.data as SubLookup | null;
  if (!sub) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }
  if (
    sub.lifecycle_state !== "SCHEDULING_IN_PROGRESS" &&
    sub.lifecycle_state !== "ACCEPTED_PENDING_SCHEDULING"
  ) {
    return NextResponse.json(
      { error: "wrong_lifecycle", actual: sub.lifecycle_state },
      { status: 409 },
    );
  }

  // Pull the remaining slots in order.
  const slotsResp = await service
    .from("curriculum_slots")
    .select("id, week_number, live_call_at")
    .eq("curriculum_id", curriculum.id)
    .is("live_call_at", null)
    .order("week_number", { ascending: true });
  const pendingSlots = (slotsResp.data ?? []) as SlotLookup[];
  if (pendingSlots.length === 0) {
    return NextResponse.json({ error: "no_pending_slots" }, { status: 409 });
  }

  // Compute the datetime for each remaining slot: anchor + (week-1)*7d.
  const anchorMs = new Date(curriculum.cycle_anchor_at).getTime();
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

  const writes: { id: string; live_call_at: string; live_call_event_id: string }[] =
    pendingSlots.map((s) => {
      const t = new Date(anchorMs + (s.week_number - 1) * oneWeekMs).toISOString();
      return {
        id: s.id,
        live_call_at: t,
        // Sentinel: distinguishes auto-booked slots from Calendly-booked
        // ones (whose IDs are full Calendly event URIs). Webhook handlers
        // that look up slots by event URI will skip these.
        live_call_event_id: `auto:${s.id}`,
      };
    });

  for (const w of writes) {
    const upd = await service
      .from("curriculum_slots")
      .update({
        live_call_at: w.live_call_at,
        live_call_event_id: w.live_call_event_id,
      } as never)
      .eq("id", w.id);
    if (upd.error) {
      console.error("[auto-book] slot update failed", upd.error);
      return NextResponse.json({ error: "slot_update_failed" }, { status: 500 });
    }
  }

  // Advance lifecycle to PENDING_PAYMENT now that all 4 slots are set.
  const subUpdate = await service
    .from("subscriptions")
    .update({
      lifecycle_state: "PENDING_PAYMENT",
      payment_pending_at: new Date().toISOString(),
      waiting_on: "PARENT",
    } as never)
    .eq("id", sub.id);
  if (subUpdate.error) {
    console.error("[auto-book] lifecycle update failed", subUpdate.error);
    return NextResponse.json({ error: "lifecycle_update_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    booked_slots: writes.length,
  });
}
