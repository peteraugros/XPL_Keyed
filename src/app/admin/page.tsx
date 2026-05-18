// /admin — Tim's coach dashboard. Trial-window slice of Task 7c.
//
// Server Component handles auth + coach gate + data fetch. Interactive
// elements (Discord URL form, eventual Stage C buttons) live in AdminClient.
//
// Coach gate:
//   * unauthenticated                 -> /login?next=/admin
//   * authed coach row matches uid    -> render
//   * authed coach row matches email
//     but auth_user_id is NULL        -> auto-link, then render
//                                        (one-shot self-healing — the seed
//                                        migration intentionally leaves
//                                        coaches.auth_user_id NULL so we
//                                        don't have to chicken-and-egg
//                                        the Tim row creation)
//   * authed parent / player          -> /portal or /play
//   * orphan auth user                -> /login?error=no_role
//
// What this version shows:
//   * Stats strip — paying / trials this week / waitlist count + oldest.
//   * New Trials cards — every subscription.status='trial', joined with
//     player, parent, quest_completions, latest VOD, prep responses.
//     Each card has an inline form for Tim to paste the per-kid Discord
//     channel invite URL.
//   * Active Clients list — every subscription.status='active'.
//   * Revenue MTD — stubbed at $0 today; wires up when Stripe invoice
//     events are landing real payments.
//
// What's DELIBERATELY OUT:
//   * Upcoming Calls list. Trial-call dates aren't stored on the
//     subscription yet (flagged on /portal). Paid-lesson calls live in
//     curriculum_slots, but there are none in trial state. Skipped until
//     that data lands.
//   * Stage C "Take Jake on / Decline / Still deciding" buttons. They
//     belong to the curriculum drafter — its own task downstream.
//   * Multi-coach polish. Single coach (Tim) for MVP; the schema
//     supports multi-coach, but we pull Tim's row directly.

import { redirect as _redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import AdminClient from "./AdminClient";
import styles from "./page.module.css";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

export const dynamic = "force-dynamic";

type CoachLookup = {
  id: string;
  email: string;
  display_name: string;
  auth_user_id: string | null;
  is_active: boolean;
};
type IdLookup = { id: string };

type SubscriptionRow = {
  id: string;
  player_id: string;
  status: string;
  tier: string;
  cycle_lessons_delivered: number;
  cycle_cancels_used: number;
  created_at: string;
};

type PlayerRow = {
  id: string;
  family_id: string;
  first_name: string;
  age: number;
  fortnite_username: string | null;
  discord_username: string | null;
  current_rank: string | null;
  platform: string | null;
  hours_per_week: number | null;
  discord_channel_url: string | null;
};

type ParentRow = {
  family_id: string;
  first_name: string;
  email: string;
};

type QuestRow = { player_id: string; quest_key: string };

type VodRow = {
  player_id: string;
  url: string;
  created_at: string;
};

type PrepRow = {
  player_id: string;
  q1_choice: string;
  q1_other_text: string | null;
  q2_choice: string;
  q2_other_text: string | null;
  q3_reflection: string;
};

type MessageRow = {
  id: string;
  player_id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
  created_at: string;
};

type WaitlistRow = { created_at: string };

export default async function AdminPage() {
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) redirect("/login?next=/admin");

  // Coach gate. Try auth_user_id match first.
  let coachLookup = await supabase
    .from("coaches")
    .select("id, email, display_name, auth_user_id, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  let coach = coachLookup.data as CoachLookup | null;

  // Auto-link branch: coach with matching email but no auth_user_id yet.
  // Service role client because the cookie-bound client can't UPDATE a row
  // it doesn't own under the coach RLS (and at this moment auth.uid()
  // hasn't been written to the coach row, so the policy denies the write).
  if (!coach && user.email) {
    const adminClient = createServiceRoleClient();
    const unlinkedLookup = await adminClient
      .from("coaches")
      .select("id, email, display_name, auth_user_id, is_active")
      .ilike("email", user.email)
      .is("auth_user_id", null)
      .maybeSingle();
    const unlinked = unlinkedLookup.data as CoachLookup | null;
    if (unlinked?.id && unlinked.is_active) {
      const linkResult = await adminClient
        .from("coaches")
        .update({ auth_user_id: user.id } as never)
        .eq("id", unlinked.id);
      if (linkResult.error) {
        console.error("[admin] coach auto-link failed", linkResult.error);
      } else {
        coach = { ...unlinked, auth_user_id: user.id };
      }
    }
  }

  if (!coach || !coach.is_active) {
    // Not a coach. Same role-redirect tree as the other portals.
    const parentRow = await supabase
      .from("parents")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((parentRow.data as IdLookup | null)?.id) redirect("/portal");

    const playerRow = await supabase
      .from("players")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((playerRow.data as IdLookup | null)?.id) redirect("/play");

    redirect("/login?error=no_role");
  }

  // We're authenticated as the coach. Coach RLS (*_coach_all) gives full
  // SELECT/INSERT/UPDATE on every business table.
  const [
    subsLookup,
    waitlistOldestLookup,
    waitlistCountLookup,
  ] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("id, player_id, status, tier, cycle_lessons_delivered, cycle_cancels_used, created_at")
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
  const actives = subscriptions.filter((s) => s.status === "active");
  const playerIds = subscriptions.map((s) => s.player_id);

  let players: PlayerRow[] = [];
  let parents: ParentRow[] = [];
  let quests: QuestRow[] = [];
  let vods: VodRow[] = [];
  let preps: PrepRow[] = [];
  let messages: MessageRow[] = [];
  if (playerIds.length > 0) {
    const playerLookup = await supabase
      .from("players")
      .select(
        "id, family_id, first_name, age, fortnite_username, discord_username, current_rank, platform, hours_per_week, discord_channel_url",
      )
      .in("id", playerIds);
    players = (playerLookup.data ?? []) as PlayerRow[];

    const familyIds = Array.from(new Set(players.map((p) => p.family_id)));
    const [parentLookup, questLookup, vodLookup, prepLookup, messageLookup] = await Promise.all([
      supabase
        .from("parents")
        .select("family_id, first_name, email")
        .in("family_id", familyIds),
      supabase
        .from("quest_completions")
        .select("player_id, quest_key")
        .in("player_id", playerIds),
      supabase
        .from("vod_uploads")
        .select("player_id, url, created_at")
        .in("player_id", playerIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("prep_responses")
        .select("player_id, q1_choice, q1_other_text, q2_choice, q2_other_text, q3_reflection")
        .in("player_id", playerIds),
      supabase
        .from("messages")
        .select("id, player_id, sender_role, body, created_at")
        .in("player_id", playerIds)
        .order("created_at", { ascending: true })
        .limit(500),
    ]);
    parents = (parentLookup.data ?? []) as ParentRow[];
    quests = (questLookup.data ?? []) as QuestRow[];
    vods = (vodLookup.data ?? []) as VodRow[];
    preps = (prepLookup.data ?? []) as PrepRow[];
    messages = (messageLookup.data ?? []) as MessageRow[];
  }

  // Stats
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const trialsThisWeek = trials.filter(
    (s) => new Date(s.created_at) >= sevenDaysAgo,
  ).length;
  const waitlistOldest = (waitlistOldestLookup.data as WaitlistRow | null)?.created_at;
  const waitlistDays = waitlistOldest
    ? Math.floor((Date.now() - new Date(waitlistOldest).getTime()) / (1000 * 3600 * 24))
    : null;
  const waitlistCount = (waitlistCountLookup as unknown as { count: number | null }).count ?? 0;

  // Index helpers for the client
  const playersById = new Map(players.map((p) => [p.id, p]));
  const parentByFamily = new Map(parents.map((p) => [p.family_id, p]));
  const questsByPlayer = new Map<string, Set<string>>();
  for (const q of quests) {
    if (!questsByPlayer.has(q.player_id)) questsByPlayer.set(q.player_id, new Set());
    questsByPlayer.get(q.player_id)!.add(q.quest_key);
  }
  const vodByPlayer = new Map<string, string>();
  for (const v of vods) {
    if (!vodByPlayer.has(v.player_id)) vodByPlayer.set(v.player_id, v.url);
  }
  const prepByPlayer = new Map(preps.map((p) => [p.player_id, p]));
  const messagesByPlayer = new Map<string, MessageRow[]>();
  for (const m of messages) {
    const arr = messagesByPlayer.get(m.player_id) ?? [];
    arr.push(m);
    messagesByPlayer.set(m.player_id, arr);
  }

  const trialCards = trials.map((sub) => {
    const player = playersById.get(sub.player_id);
    const parent = player ? parentByFamily.get(player.family_id) : undefined;
    const completed = questsByPlayer.get(sub.player_id) ?? new Set<string>();
    return {
      subscription_id: sub.id,
      player_id: sub.player_id,
      player: player ?? null,
      parent: parent ?? null,
      completed_quest_keys: Array.from(completed),
      latest_vod_url: vodByPlayer.get(sub.player_id) ?? null,
      prep: prepByPlayer.get(sub.player_id) ?? null,
      messages: messagesByPlayer.get(sub.player_id) ?? [],
      created_at: sub.created_at,
    };
  });

  const activeRows = actives.map((sub) => {
    const player = playersById.get(sub.player_id);
    const parent = player ? parentByFamily.get(player.family_id) : undefined;
    return {
      subscription_id: sub.id,
      player_id: sub.player_id,
      player_first_name: player?.first_name ?? "(unknown)",
      parent_first_name: parent?.first_name ?? "(unknown)",
      cycle_lessons_delivered: sub.cycle_lessons_delivered,
      cycle_cancels_used: sub.cycle_cancels_used,
      messages: messagesByPlayer.get(sub.player_id) ?? [],
    };
  });

  // Focused-mode Home: top task from derived_tasks_view + remaining count.
  // Per Coach Dashboard Spec/CEO/admin-spec-focused.md section 4 ("One Thing").
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
    .limit(20); // top 20 — Home uses #1, expansion section uses #2..N
  const tasks = (tasksLookup.data ?? []) as DerivedTask[];
  const topTask = tasks[0] ?? null;
  const remainingTasks = tasks.length > 1 ? tasks.length - 1 : 0;

  return (
    <div className={styles.shell}>
      <AdminClient
        coachName={coach.display_name}
        stats={{
          payingCount: actives.length,
          capacity: 12,
          trialsThisWeek,
          waitlistCount,
          waitlistOldestDays: waitlistDays,
        }}
        topTask={topTask}
        remainingTasks={remainingTasks}
        trialCards={trialCards}
        activeRows={activeRows}
      />
    </div>
  );
}
