// /admin — Tim's Home briefing.
//
// Auth + role gate is handled by /admin/layout.tsx via requireCoachSession.
// This page only fetches Home data: focused-mode tasks, command-mode
// pipeline cards (+ waitlist), stuck-return banner notes, done-today
// counter, and the stats strip.
//
// Trial cards, active client rows, and Tim ↔ Dad channel are no longer
// rendered here — they live on /admin/clients and /admin/dad. The shell
// (admin/layout.tsx) owns the brand, coach name, and sign out.

import { requireCoachSession } from "./_lib/session";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

type SubscriptionRow = {
  id: string;
  player_id: string;
  status: string;
  cycle_lessons_delivered: number;
  cycle_cancels_used: number;
  created_at: string;
  lifecycle_state?: string;
  waiting_on?: string;
};
type PlayerSummary = { id: string; family_id: string; first_name: string };
type ParentSummary = { family_id: string; first_name: string };
type QuestRow = { player_id: string; quest_key: string };
type WaitlistRow = { created_at: string };

export default async function AdminHome() {
  const { supabase, coach } = await requireCoachSession();

  // Subscriptions powers two things on Home:
  //   1. Stats — count actives (active + past_due + pending_cancel) vs cap,
  //              count trials this week.
  //   2. Pipeline (Command mode) — one row per kid keyed by lifecycle_state.
  const [
    subsLookup,
    waitlistOldestLookup,
    waitlistCountLookup,
  ] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "id, player_id, status, cycle_lessons_delivered, cycle_cancels_used, created_at, lifecycle_state, waiting_on",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("waitlist_entries")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("waitlist_entries")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const subscriptions = (subsLookup.data ?? []) as SubscriptionRow[];
  const trials = subscriptions.filter((s) => s.status === "trial");
  const activeIsh = subscriptions.filter(
    (s) =>
      s.status === "active" ||
      s.status === "past_due" ||
      s.status === "pending_cancel",
  );

  // Player + parent lookups for Pipeline names (Command mode shows kid +
  // parent first name on each card).
  const playerIds = subscriptions.map((s) => s.player_id);
  let players: PlayerSummary[] = [];
  let parents: ParentSummary[] = [];
  let quests: QuestRow[] = [];
  if (playerIds.length > 0) {
    const playerLookup = await supabase
      .from("players")
      .select("id, family_id, first_name")
      .in("id", playerIds);
    players = (playerLookup.data ?? []) as PlayerSummary[];

    const familyIds = Array.from(new Set(players.map((p) => p.family_id)));
    const [parentLookup, questLookup] = await Promise.all([
      supabase
        .from("parents")
        .select("family_id, first_name")
        .in("family_id", familyIds),
      supabase
        .from("quest_completions")
        .select("player_id, quest_key")
        .in("player_id", playerIds),
    ]);
    parents = (parentLookup.data ?? []) as ParentSummary[];
    quests = (questLookup.data ?? []) as QuestRow[];
  }

  const playersById = new Map(players.map((p) => [p.id, p]));
  const parentByFamily = new Map(parents.map((p) => [p.family_id, p]));
  const questsByPlayer = new Map<string, Set<string>>();
  for (const q of quests) {
    if (!questsByPlayer.has(q.player_id)) questsByPlayer.set(q.player_id, new Set());
    questsByPlayer.get(q.player_id)!.add(q.quest_key);
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const trialsThisWeek = trials.filter(
    (s) => new Date(s.created_at) >= sevenDaysAgo,
  ).length;

  const waitlistOldest = (waitlistOldestLookup.data as WaitlistRow | null)?.created_at;
  const waitlistDays = waitlistOldest
    ? Math.floor((Date.now() - new Date(waitlistOldest).getTime()) / (1000 * 3600 * 24))
    : null;
  const waitlistCount =
    (waitlistCountLookup as unknown as { count: number | null }).count ?? 0;

  // Focused-mode Home: top task from derived_tasks_view + remaining.
  type DerivedTask = {
    task_type: string;
    client_id: string;
    client_name: string;
    age_in_state: string;
    source_object_id: string;
    priority_score: number;
    task_payload: Record<string, unknown> | null;
  };
  const tasksLookup = await supabase
    .from("derived_tasks_view")
    .select("task_type, client_id, client_name, age_in_state, source_object_id, priority_score, task_payload")
    .order("priority_score", { ascending: false })
    .order("age_in_state", { ascending: false })
    .limit(20);
  const tasks = (tasksLookup.data ?? []) as DerivedTask[];

  type ReturnedStuck = {
    id: string;
    object_type: string;
    resolution_note: string;
    resolved_at: string;
  };
  const returnedLookup = await supabase
    .from("stuck_events")
    .select("id, object_type, resolution_note, resolved_at")
    .not("resolved_at", "is", null)
    .not("resolution_note", "is", null)
    .is("tim_seen_at", null)
    .order("resolved_at", { ascending: false })
    .limit(10);
  const returnedStucks = (returnedLookup.data ?? []) as ReturnedStuck[];

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const doneTodayLookup = await supabase
    .from("task_completions")
    .select("id", { count: "exact", head: true })
    .eq("coach_id", coach.id)
    .gte("completed_at", todayStart.toISOString());
  const doneToday =
    (doneTodayLookup as unknown as { count: number | null }).count ?? 0;

  // Welcome contexts: for any new_student_welcome task on Tim's Home,
  // fetch the 4 booked curriculum slots so the welcome card can render
  // the dates + the .ics download link without a client round-trip.
  // task_payload.subscription_id identifies which row to pull.
  type WelcomeSlot = {
    week_number: number;
    live_call_at: string | null;
    live_call_event_id: string | null;
  };
  type WelcomeContext = {
    subscription_id: string;
    player_id: string;
    slots: WelcomeSlot[];
    has_auto_booked: boolean;
  };
  const welcomeTaskSubIds = tasks
    .filter((t) => t.task_type === "new_student_welcome")
    .map((t) => (t.task_payload?.subscription_id as string | undefined) ?? null)
    .filter((id): id is string => !!id);
  const welcomeContexts: WelcomeContext[] = [];
  if (welcomeTaskSubIds.length > 0) {
    const subRows = await supabase
      .from("subscriptions")
      .select("id, player_id")
      .in("id", welcomeTaskSubIds);
    const subList = (subRows.data ?? []) as Array<{ id: string; player_id: string }>;
    const playerIdsForWelcome = subList.map((s) => s.player_id);
    const curriculaRows = await supabase
      .from("curricula")
      .select("id, player_id")
      .in("player_id", playerIdsForWelcome)
      .eq("status", "active");
    const curriculaByPlayer = new Map<string, string>();
    for (const c of (curriculaRows.data ?? []) as Array<{ id: string; player_id: string }>) {
      curriculaByPlayer.set(c.player_id, c.id);
    }
    const curriculumIds = Array.from(curriculaByPlayer.values());
    const slotsRows =
      curriculumIds.length > 0
        ? await supabase
            .from("curriculum_slots")
            .select("curriculum_id, week_number, live_call_at, live_call_event_id")
            .in("curriculum_id", curriculumIds)
            .order("week_number", { ascending: true })
        : { data: [] };
    const slotsByCurriculum = new Map<string, WelcomeSlot[]>();
    for (const s of (slotsRows.data ?? []) as Array<{
      curriculum_id: string;
      week_number: number;
      live_call_at: string | null;
      live_call_event_id: string | null;
    }>) {
      const arr = slotsByCurriculum.get(s.curriculum_id) ?? [];
      arr.push({
        week_number: s.week_number,
        live_call_at: s.live_call_at,
        live_call_event_id: s.live_call_event_id,
      });
      slotsByCurriculum.set(s.curriculum_id, arr);
    }
    for (const s of subList) {
      const curriculumId = curriculaByPlayer.get(s.player_id);
      const slots = curriculumId ? slotsByCurriculum.get(curriculumId) ?? [] : [];
      welcomeContexts.push({
        subscription_id: s.id,
        player_id: s.player_id,
        slots,
        has_auto_booked: slots.some((sl) =>
          sl.live_call_event_id?.startsWith("auto:"),
        ),
      });
    }
  }

  // Trial-booked contexts: for any new_trial_booked task on Tim's Home,
  // fetch kid age + parent email + prep completion count so the card
  // can show readiness at a glance.
  type TrialBookedContext = {
    subscription_id: string;
    player_id: string;
    kid_age: number;
    parent_first_name: string;
    parent_email: string;
    prep_completed: number;
    total_quests: number;
    trial_call_at: string | null;
  };
  const trialBookedTaskSubIds = tasks
    .filter((t) => t.task_type === "new_trial_booked")
    .map((t) => (t.task_payload?.subscription_id as string | undefined) ?? null)
    .filter((id): id is string => !!id);
  const trialBookedContexts: TrialBookedContext[] = [];
  if (trialBookedTaskSubIds.length > 0) {
    const subRows = await supabase
      .from("subscriptions")
      .select("id, player_id, trial_call_at")
      .in("id", trialBookedTaskSubIds);
    const subList = (subRows.data ?? []) as Array<{
      id: string;
      player_id: string;
      trial_call_at: string | null;
    }>;
    const playerIdsForTrial = subList.map((s) => s.player_id);
    const playerRows = await supabase
      .from("players")
      .select("id, family_id, age")
      .in("id", playerIdsForTrial);
    const playerById = new Map(
      ((playerRows.data ?? []) as Array<{
        id: string;
        family_id: string;
        age: number;
      }>).map((p) => [p.id, p]),
    );
    const familyIdsForTrial = Array.from(
      new Set(
        Array.from(playerById.values()).map((p) => p.family_id),
      ),
    );
    const parentRows = await supabase
      .from("parents")
      .select("family_id, first_name, email")
      .in("family_id", familyIdsForTrial);
    const parentByFamilyT = new Map(
      ((parentRows.data ?? []) as Array<{
        family_id: string;
        first_name: string;
        email: string;
      }>).map((p) => [p.family_id, p]),
    );
    const questRows = await supabase
      .from("quest_completions")
      .select("player_id, quest_key")
      .in("player_id", playerIdsForTrial);
    const questsByPlayerT = new Map<string, number>();
    for (const q of ((questRows.data ?? []) as Array<{ player_id: string }>)) {
      questsByPlayerT.set(q.player_id, (questsByPlayerT.get(q.player_id) ?? 0) + 1);
    }
    for (const s of subList) {
      const p = playerById.get(s.player_id);
      if (!p) continue;
      const parent = parentByFamilyT.get(p.family_id);
      trialBookedContexts.push({
        subscription_id: s.id,
        player_id: s.player_id,
        kid_age: p.age,
        parent_first_name: parent?.first_name ?? "(unknown)",
        parent_email: parent?.email ?? "",
        prep_completed: questsByPlayerT.get(s.player_id) ?? 0,
        total_quests: 4,
        trial_call_at: s.trial_call_at,
      });
    }
  }

  const waitlistEntriesLookup = await supabase
    .from("waitlist_entries")
    .select("id, parent_email, kid_first_name, kid_age, created_at, status")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const waitlistEntries = (waitlistEntriesLookup.data ?? []) as Array<{
    id: string;
    parent_email: string;
    kid_first_name: string;
    kid_age: number | null;
    created_at: string;
    status: string;
  }>;

  // Pipeline cards — one row per subscription with denormalized names.
  const pipelineCards = subscriptions.map((sub) => {
    const player = playersById.get(sub.player_id);
    const parent = player ? parentByFamily.get(player.family_id) : undefined;
    const completed = questsByPlayer.get(sub.player_id) ?? new Set<string>();
    return {
      subscription_id: sub.id,
      player_id: sub.player_id,
      player_first_name: player?.first_name ?? "(unknown)",
      parent_first_name: parent?.first_name ?? "(unknown)",
      lifecycle_state: sub.lifecycle_state ?? "TRIAL_PREP",
      waiting_on: sub.waiting_on ?? "SYSTEM",
      cycle_lessons_delivered: sub.cycle_lessons_delivered,
      cycle_cancels_used: sub.cycle_cancels_used,
      prep_completed: completed.size,
    };
  });

  return (
    <AdminClient
      coachMode={coach.admin_mode}
      stats={{
        payingCount: activeIsh.length,
        capacity: 12,
        trialsThisWeek,
        waitlistCount,
        waitlistOldestDays: waitlistDays,
      }}
      tasks={tasks}
      pipelineCards={pipelineCards}
      waitlistEntries={waitlistEntries}
      returnedStucks={returnedStucks}
      doneToday={doneToday}
      welcomeContexts={welcomeContexts}
      trialBookedContexts={trialBookedContexts}
    />
  );
}
