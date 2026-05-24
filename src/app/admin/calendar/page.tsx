// /admin/calendar — Tim's schedule. List + Day + Week + Month views.
//
// Two event sources:
//   1. Paid lesson live calls (curriculum_slots.live_call_at) — for
//      active subscriptions, not yet delivered/cancelled.
//   2. Trial intro calls (subscriptions.trial_call_at) — for trial
//      subscriptions.
//
// Fetch window: 90 days back, 180 days forward. List view filters to
// today-forward in the client; grid views render the full window so
// past Mondays don't appear empty when Tim navigates back. Window cap
// keeps the page from dragging at 100+ active clients (well above MVP
// scale).

import { requireCoachSession } from "../_lib/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import CalendarClient, { type CalendarEvent } from "./CalendarClient";

export const dynamic = "force-dynamic";

type SlotRow = {
  id: string;
  curriculum_id: string;
  week_number: number;
  is_vod_review: boolean;
  lesson_id: string | null;
  live_call_at: string;
  live_call_event_id: string | null;
};
type CurriculumRow = { id: string; player_id: string; status: string };
type LessonRow = {
  id: string;
  fortnite_label: string;
  parent_label: string;
  parent_skill_description: string;
};
type PlayerRow = {
  id: string;
  first_name: string;
  family_id: string;
  fortnite_username: string | null;
  discord_username: string | null;
  current_rank: string | null;
};
type ParentRow = { family_id: string; first_name: string; email: string };
type TrialSubRow = {
  id: string;
  player_id: string;
  trial_call_at: string;
  trial_call_event_uri: string | null;
};

function coachReasonLabel(raw: string): string {
  switch (raw) {
    case "sick":
      return "sick";
    case "out_of_control":
      return "something out of his control";
    case "need_to_reschedule":
      return "needed to reschedule";
    default:
      return raw;
  }
}

export default async function CalendarPage() {
  await requireCoachSession();
  const supabase = createServiceRoleClient();

  // Window: 90 days back through 180 days forward. Wide enough for any
  // realistic grid-view navigation; small enough to keep one page-fetch
  // fast even at operator-pair scale (100+ kids × 1 lesson/week =
  // ~12000 slots over 90 days, well within Postgres comfort).
  const startOfWindow = new Date();
  startOfWindow.setHours(0, 0, 0, 0);
  startOfWindow.setDate(startOfWindow.getDate() - 90);
  const endOfWindow = new Date();
  endOfWindow.setHours(23, 59, 59, 999);
  endOfWindow.setDate(endOfWindow.getDate() + 180);
  const windowStartIso = startOfWindow.toISOString();
  const windowEndIso = endOfWindow.toISOString();

  // 1. Paid lesson live calls.
  //    Includes BOTH live (not delivered, not cancelled) AND cancelled
  //    (event_id sentinel'd) slots — cancelled events render with a
  //    strikethrough so Tim can still see "Wednesday with Jake was a
  //    cancel." Past-delivered slots (delivered_at set without a
  //    cancellation reason) stay hidden — they're history, not future
  //    schedule.
  const slotsResp = await supabase
    .from("curriculum_slots")
    .select(
      "id, curriculum_id, week_number, is_vod_review, lesson_id, live_call_at, live_call_event_id, delivered_at",
    )
    .not("live_call_at", "is", null)
    .gte("live_call_at", windowStartIso)
    .lte("live_call_at", windowEndIso)
    .order("live_call_at", { ascending: true });
  const allSlots = (slotsResp.data ?? []) as Array<SlotRow & { delivered_at: string | null }>;
  // A slot is "on the calendar" if it has a live_call_at. Past delivered
  // slots stay visible (grid views render them at reduced opacity as
  // historical record); cancelled slots stay visible with strikethrough.
  const slots = allSlots;

  // Pull curricula + verify status='active' (we only want live calls
  // for active cycles; pending_approval slots aren't real bookings yet)
  const curriculumIds = Array.from(new Set(slots.map((s) => s.curriculum_id)));
  let activeCurriculaIds = new Set<string>();
  let playerByCurriculum = new Map<string, string>();
  if (curriculumIds.length > 0) {
    const curRows = await supabase
      .from("curricula")
      .select("id, player_id, status")
      .in("id", curriculumIds);
    for (const c of (curRows.data ?? []) as CurriculumRow[]) {
      if (c.status === "active") {
        activeCurriculaIds.add(c.id);
        playerByCurriculum.set(c.id, c.player_id);
      }
    }
  }
  const liveSlots = slots.filter((s) => activeCurriculaIds.has(s.curriculum_id));

  // Pull lessons for titles
  const lessonIds = Array.from(
    new Set(liveSlots.map((s) => s.lesson_id).filter((id): id is string => !!id)),
  );
  const lessonsById = new Map<string, LessonRow>();
  if (lessonIds.length > 0) {
    const lessonResp = await supabase
      .from("lessons")
      .select("id, fortnite_label, parent_label, parent_skill_description")
      .in("id", lessonIds);
    for (const l of (lessonResp.data ?? []) as LessonRow[]) {
      lessonsById.set(l.id, l);
    }
  }

  // Pull cancel reasons for any cancelled slots. Two sources:
  //   * coach_cancels.reason (Tim cancelled) — keyed by curriculum_slot_id
  //   * cancellation_events (parent cancelled) — keyed by curriculum_slot_id,
  //     gives classification (credit / forfeit) + initiated_via
  const cancelledSlotIds = liveSlots
    .filter((s) => (s.live_call_event_id ?? "").startsWith("cancelled:"))
    .map((s) => s.id);
  const cancelReasonBySlot = new Map<
    string,
    { source: "coach" | "parent"; label: string }
  >();
  if (cancelledSlotIds.length > 0) {
    const [coachCancResp, parentCancResp] = await Promise.all([
      supabase
        .from("coach_cancels")
        .select("curriculum_slot_id, reason, created_at")
        .in("curriculum_slot_id", cancelledSlotIds),
      supabase
        .from("cancellation_events")
        .select("curriculum_slot_id, classification, initiated_via, created_at")
        .in("curriculum_slot_id", cancelledSlotIds)
        .order("created_at", { ascending: false }),
    ]);
    // Coach cancels win when both exist (more specific reason).
    for (const cc of (coachCancResp.data ?? []) as Array<{
      curriculum_slot_id: string;
      reason: string;
    }>) {
      const friendly = coachReasonLabel(cc.reason);
      cancelReasonBySlot.set(cc.curriculum_slot_id, {
        source: "coach",
        label: `Tim cancelled: ${friendly}`,
      });
    }
    for (const pc of (parentCancResp.data ?? []) as Array<{
      curriculum_slot_id: string | null;
      classification: string;
      initiated_via: string;
    }>) {
      if (!pc.curriculum_slot_id) continue;
      if (cancelReasonBySlot.has(pc.curriculum_slot_id)) continue;
      const via = pc.initiated_via === "no_show" ? "no show" : "parent cancel";
      const cls = pc.classification === "forfeit" ? "inside 24hr" : "skip used";
      cancelReasonBySlot.set(pc.curriculum_slot_id, {
        source: "parent",
        label: `${via} (${cls})`,
      });
    }
  }

  // 2. Trial calls — upcoming or earlier-today, status='trial' only.
  const trialResp = await supabase
    .from("subscriptions")
    .select("id, player_id, trial_call_at, trial_call_event_uri")
    .eq("status", "trial")
    .not("trial_call_at", "is", null)
    .gte("trial_call_at", windowStartIso)
    .lte("trial_call_at", windowEndIso)
    .order("trial_call_at", { ascending: true });
  const trialSubs = (trialResp.data ?? []) as TrialSubRow[];

  // Pull all relevant players + parents
  const allPlayerIds = Array.from(
    new Set([
      ...liveSlots.map((s) => playerByCurriculum.get(s.curriculum_id)).filter((id): id is string => !!id),
      ...trialSubs.map((t) => t.player_id),
    ]),
  );
  const playersById = new Map<string, PlayerRow>();
  const parentByFamily = new Map<string, ParentRow>();
  if (allPlayerIds.length > 0) {
    const playerResp = await supabase
      .from("players")
      .select("id, first_name, family_id, fortnite_username, discord_username, current_rank")
      .in("id", allPlayerIds);
    const players = (playerResp.data ?? []) as PlayerRow[];
    for (const p of players) playersById.set(p.id, p);

    const familyIds = Array.from(new Set(players.map((p) => p.family_id)));
    if (familyIds.length > 0) {
      const parentResp = await supabase
        .from("parents")
        .select("family_id, first_name, email")
        .in("family_id", familyIds);
      for (const p of (parentResp.data ?? []) as ParentRow[]) {
        parentByFamily.set(p.family_id, p);
      }
    }
  }

  // Build the unified event list
  const events: CalendarEvent[] = [];

  for (const s of liveSlots) {
    const playerId = playerByCurriculum.get(s.curriculum_id);
    if (!playerId) continue;
    const player = playersById.get(playerId);
    if (!player) continue;
    const parent = parentByFamily.get(player.family_id);
    const lesson = s.lesson_id ? lessonsById.get(s.lesson_id) ?? null : null;
    const cancelled = (s.live_call_event_id ?? "").startsWith("cancelled:");
    const cancelInfo = cancelReasonBySlot.get(s.id);
    events.push({
      id: `slot:${s.id}`,
      kind: "paid_lesson",
      when_iso: s.live_call_at,
      delivered_at: s.delivered_at,
      week_number: s.week_number,
      is_vod_review: s.is_vod_review,
      slot_id: s.id,
      player_id: player.id,
      kid_first_name: player.first_name,
      kid_fortnite_username: player.fortnite_username,
      kid_discord_username: player.discord_username,
      kid_current_rank: player.current_rank,
      parent_first_name: parent?.first_name ?? null,
      parent_email: parent?.email ?? null,
      lesson_fortnite_label: lesson?.fortnite_label ?? null,
      lesson_parent_label: lesson?.parent_label ?? null,
      lesson_skill_description: lesson?.parent_skill_description ?? null,
      lesson_is_stub: !lesson, // genuine stub means no lesson_id resolved
      cancelled,
      cancel_reason: cancelInfo?.label ?? null,
      cancel_source: cancelInfo?.source ?? null,
    });
  }

  for (const t of trialSubs) {
    const player = playersById.get(t.player_id);
    if (!player) continue;
    const parent = parentByFamily.get(player.family_id);
    events.push({
      id: `trial:${t.id}`,
      kind: "trial_call",
      when_iso: t.trial_call_at,
      delivered_at: null,
      subscription_id: t.id,
      player_id: player.id,
      kid_first_name: player.first_name,
      kid_fortnite_username: player.fortnite_username,
      kid_discord_username: player.discord_username,
      kid_current_rank: player.current_rank,
      parent_first_name: parent?.first_name ?? null,
      parent_email: parent?.email ?? null,
    });
  }

  events.sort((a, b) => a.when_iso.localeCompare(b.when_iso));

  return <CalendarClient events={events} />;
}
