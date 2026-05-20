// Auto-renew helpers per /Users/peteraugros/Desktop/xpl-reschedule-spec.md.
//
// Two main entry points:
//   * detectUniformPattern(slots) — was the just-finished cycle running
//     on a stable rhythm? (Same weekday + time-of-day within 15min.)
//   * provisionNextCycle(args) — called by the Stripe webhook on
//     payment_intent.succeeded for a renewal. Creates new curriculum +
//     4 slots, transitions lifecycle, resets counters.
//
// All cadence math runs in subscription.cycle_timezone (frozen per the
// spec). UI may render in the user's local browser timezone separately.

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";

type Supa = SupabaseClient<Database>;

const UNIFORM_TIME_WINDOW_MINUTES = 15;
const TIME_WINDOW_MS = UNIFORM_TIME_WINDOW_MINUTES * 60 * 1000;

export type SlotForPattern = {
  week_number: number;
  live_call_at: string | null;
};

export type UniformPattern = {
  uniform: true;
  // Anchor: the canonical time-of-day + weekday across all 4 slots,
  // expressed as the ISO of slot 1 (which becomes the basis for
  // computing +1/+2/+3/+4 weeks for the next cycle).
  anchor_iso: string;
};
export type ScatteredPattern = { uniform: false };

// Detect: are all 4 just-delivered slots on the same weekday + within a
// 15-minute window of the same time-of-day? Slots with NULL live_call_at
// disqualify the pattern (incomplete data → can't claim uniform).
export function detectUniformPattern(
  slots: SlotForPattern[],
  timezone: string,
): UniformPattern | ScatteredPattern {
  const filled = slots
    .filter((s): s is SlotForPattern & { live_call_at: string } => !!s.live_call_at)
    .sort((a, b) => a.week_number - b.week_number);
  if (filled.length < 4) return { uniform: false };

  // Reduce each slot to (weekday, minute-of-day) IN the frozen timezone.
  // We use Intl.DateTimeFormat with the timezone option to extract local
  // hour/minute/weekday — Date.getDay() uses runtime locale, not what we
  // want here.
  function reduce(iso: string): { weekday: string; minuteOfDay: number; epoch: number } {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "?";
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    return { weekday, minuteOfDay: hour * 60 + minute, epoch: d.getTime() };
  }

  const reduced = filled.map((s) => reduce(s.live_call_at));
  const baseWeekday = reduced[0].weekday;
  const baseMinute = reduced[0].minuteOfDay;

  for (const r of reduced) {
    if (r.weekday !== baseWeekday) return { uniform: false };
    if (Math.abs(r.minuteOfDay - baseMinute) > UNIFORM_TIME_WINDOW_MINUTES) {
      return { uniform: false };
    }
  }

  return { uniform: true, anchor_iso: filled[0].live_call_at };
}

// Predict slot N's time given an anchor (the first slot of the prior
// cycle) + offset weeks. Pure addition in UTC; the human-readable
// rendering happens at display time.
export function predictWeeklyIso(anchorIso: string, weeksOffset: number): string {
  return new Date(
    new Date(anchorIso).getTime() + weeksOffset * 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
}

// --- Provision next cycle ---------------------------------------------------

export type ProvisionArgs = {
  supabase: Supa; // service-role
  subscriptionId: string;
  // Optional: pass in the just-completed curriculum's slots to avoid
  // refetching. If omitted we fetch them.
  completedSlots?: SlotForPattern[];
};

export type ProvisionResult = {
  newCurriculumId: string;
  pattern: UniformPattern | ScatteredPattern;
  // Lifecycle state to transition the subscription to. ACTIVE if uniform
  // (soft-booked at predicted times), SCHEDULING_IN_PROGRESS if scattered.
  nextLifecycle: "ACTIVE" | "SCHEDULING_IN_PROGRESS";
};

// Pull lesson_ids that this player has been assigned in ANY prior
// curriculum slot, ordered by the curriculum's created_at (oldest
// first) so the "top up from history" fallback feels chronological.
async function fetchPriorLessonIds(
  supabase: Supa,
  playerId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("curriculum_slots")
    .select("lesson_id, curricula!inner(player_id, created_at)")
    .eq("curricula.player_id", playerId)
    .not("lesson_id", "is", null)
    .order("created_at", { ascending: true, referencedTable: "curricula" });
  if (error) {
    console.error("[auto-renew] fetchPriorLessonIds failed", error);
    return [];
  }
  return ((data ?? []) as Array<{ lesson_id: string | null }>)
    .map((r) => r.lesson_id)
    .filter((id): id is string => !!id);
}

// Selects 4 lesson ids for the new cycle's slots. Library-first, with
// fallbacks. See provisionNextCycle for the full chain documentation.
export async function selectLessonsForRenewal(
  supabase: Supa,
  playerId: string,
  createdBy: string,
): Promise<string[]> {
  const priorIds = await fetchPriorLessonIds(supabase, playerId);
  const priorSet = new Set(priorIds);

  // Pull every published lesson, oldest first.
  const libResp = await supabase
    .from("lessons")
    .select("id, created_at")
    .eq("is_published", true)
    .order("created_at", { ascending: true });
  const libRows = (libResp.data ?? []) as Array<{ id: string }>;
  const libIds = libRows.map((r) => r.id);

  // Fresh = published + never assigned to this player.
  const fresh = libIds.filter((id) => !priorSet.has(id));
  if (fresh.length >= 4) return fresh.slice(0, 4);

  // Top up from prior (oldest first — assume the kid is least likely
  // to remember those). Dedupe against fresh just in case.
  const topUp = priorIds.filter((id) => !fresh.includes(id));
  const merged = [...fresh, ...topUp].slice(0, 4);
  if (merged.length === 4) return merged;

  // Library is empty (or near-empty). Fall back to stub creation so
  // the auto-renew loop still completes. Tim sees lesson_authoring_needed
  // tasks on Focused Home and authors content during the cycle.
  const stubIds: string[] = [];
  for (let i = 0; i < 4 - merged.length; i++) {
    const stub = await supabase
      .from("lessons")
      .insert({
        title: `(Renewal stub) Week ${merged.length + i + 1}`,
        fortnite_label: "Lesson",
        parent_label: "Lesson",
        parent_skill_description: "Tim is putting this week's plan together.",
        topic: "game_sense",
        difficulty_level: "intermediate",
        duration_minutes: 30,
        slides: [],
        parent_talking_points: [],
        author_id: createdBy,
        is_published: false,
      } as never)
      .select("id")
      .single();
    const stubData = stub.data as { id: string } | null;
    if (stub.error || !stubData) {
      throw new Error(`lesson_stub_failed: ${stub.error?.message ?? "unknown"}`);
    }
    stubIds.push(stubData.id);
  }
  return [...merged, ...stubIds];
}

export async function provisionNextCycle(
  args: ProvisionArgs,
): Promise<ProvisionResult> {
  const { supabase, subscriptionId } = args;

  // Resolve subscription + player.
  const subRow = await supabase
    .from("subscriptions")
    .select(
      "id, player_id, cycle_timezone, cycle_skips_used, auto_renew_enabled",
    )
    .eq("id", subscriptionId)
    .maybeSingle();
  const sub = subRow.data as {
    id: string;
    player_id: string;
    cycle_timezone: string;
    cycle_skips_used: number;
    auto_renew_enabled: boolean;
  } | null;
  if (!sub) throw new Error("subscription_not_found");

  // Find the just-completed curriculum (status='active' + all 4 slots
  // delivered).
  const oldCurriculumRow = await supabase
    .from("curricula")
    .select("id, personalization_note")
    .eq("player_id", sub.player_id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const oldCurriculum = oldCurriculumRow.data as { id: string } | null;
  if (!oldCurriculum) throw new Error("active_curriculum_not_found");

  // Fetch the old slots for pattern detection (unless caller provided).
  let completedSlots = args.completedSlots;
  if (!completedSlots) {
    const slotsRow = await supabase
      .from("curriculum_slots")
      .select("week_number, live_call_at")
      .eq("curriculum_id", oldCurriculum.id)
      .order("week_number", { ascending: true });
    completedSlots = (slotsRow.data ?? []) as SlotForPattern[];
  }

  const pattern = detectUniformPattern(completedSlots, sub.cycle_timezone);

  // Coach for created_by — uses the original coach if available, else
  // the oldest active coach.
  const oldRow = await supabase
    .from("curricula")
    .select("created_by")
    .eq("id", oldCurriculum.id)
    .maybeSingle();
  let createdBy = (oldRow.data as { created_by: string } | null)?.created_by ?? null;
  if (!createdBy) {
    const anyCoach = await supabase
      .from("coaches")
      .select("id")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    createdBy = (anyCoach.data as { id: string } | null)?.id ?? null;
  }
  if (!createdBy) throw new Error("no_coach_for_curriculum");

  // Mark the OLD curriculum as completed.
  await supabase
    .from("curricula")
    .update({ status: "completed" } as never)
    .eq("id", oldCurriculum.id);

  // Create the NEW curriculum. status='active' immediately (the parent
  // already paid; no extra approval gate on a renewal).
  const approvalToken = crypto.randomBytes(32).toString("hex");
  const newCurriculumInsert = await supabase
    .from("curricula")
    .insert({
      player_id: sub.player_id,
      created_by: createdBy,
      status: "active",
      approval_token: approvalToken,
      personalization_note: null,
      waiting_on: "SYSTEM",
      approved_at: new Date().toISOString(),
    } as never)
    .select("id")
    .single();
  const newCurriculumData = newCurriculumInsert.data as { id: string } | null;
  if (newCurriculumInsert.error || !newCurriculumData) {
    throw new Error(
      `curriculum_insert_failed: ${newCurriculumInsert.error?.message ?? "unknown"}`,
    );
  }
  const newCurriculumId = newCurriculumData.id;

  // Library-driven lesson selection. Pull the kid's prior assigned
  // lessons (anything they've already had in a curriculum slot, any
  // status). Then pull the published library, exclude those, take the
  // first 4 ordered by lessons.created_at ASC.
  //
  // Fallback chain:
  //   1. 4 fresh published lessons → use those.
  //   2. Fewer than 4 fresh → top up from already-done lessons (oldest
  //      first). Acceptable per spec — Tim can swap mid-cycle if
  //      review repetition isn't appropriate.
  //   3. No published lessons exist → fall back to stub creation (the
  //      original behavior, preserves the auto-renew loop while Tim
  //      builds his library).
  const stubLessonIds: string[] = await selectLessonsForRenewal(
    supabase,
    sub.player_id,
    createdBy,
  );

  // Create 4 slots. Uniform: soft-book at predicted times (sentinel
  // live_call_event_id="auto:<slot_id>" — same pattern existing code
  // uses for bulk-book). Scattered: all NULL, parent picks in portal.
  for (let i = 0; i < 4; i++) {
    const slotInsert = await supabase
      .from("curriculum_slots")
      .insert({
        curriculum_id: newCurriculumId,
        week_number: i + 1,
        is_vod_review: false,
        lesson_id: stubLessonIds[i],
        vod_url: null,
        live_call_at: pattern.uniform
          ? predictWeeklyIso(pattern.anchor_iso, i + 4)
          : null,
        // live_call_event_id stays NULL for now; the cron-or-cleanup
        // step that actually books on Calendly fills this in. For MVP
        // we just have the predicted time and parents can reschedule
        // from there.
        live_call_event_id: null,
      } as never);
    if (slotInsert.error) {
      throw new Error(`slot_insert_failed: ${slotInsert.error.message}`);
    }
  }

  // Reset subscription counters + transition. Grace recovery: if the
  // just-finished cycle ran with 0 skips AND auto_renew_enabled is FALSE,
  // flip it back to TRUE — silently restoring good standing.
  const graceRecovery =
    sub.cycle_skips_used === 0 && sub.auto_renew_enabled === false;
  const nextLifecycle = pattern.uniform ? "ACTIVE" : "SCHEDULING_IN_PROGRESS";

  const subUpd = await supabase
    .from("subscriptions")
    .update({
      cycle_started_at: new Date().toISOString(),
      cycle_lessons_delivered: 0,
      cycle_skips_used: 0,
      cycle_cancels_used: 0,
      lifecycle_state: nextLifecycle,
      status: "active",
      waiting_on: "SYSTEM",
      auto_renew_enabled: graceRecovery ? true : sub.auto_renew_enabled,
      auto_renew_off_acknowledged_at: graceRecovery
        ? null
        : undefined,
      scheduling_started_at: pattern.uniform ? null : new Date().toISOString(),
      payment_pending_at: null,
    } as never)
    .eq("id", sub.id);
  if (subUpd.error) {
    throw new Error(`subscription_update_failed: ${subUpd.error.message}`);
  }

  return { newCurriculumId, pattern, nextLifecycle };
}
