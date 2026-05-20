// /admin/clients — master-detail surface.
//
// Left rail: every current client (trial + active + past_due +
// pending_cancel) as a compact row, sorted by urgency.
// Right pane: full detail for the URL-selected client (TrialCardView
// for trials, custom panel for actives). Mobile: rail-only by default,
// tap-through to detail-only with a "Back" button.
//
// Why a single page: Stage C drafter, messages thread, prep readout
// all live in one client at a time. The rail is the index; the detail
// is the work surface. No huge stacked cards anymore.

import { requireCoachSession } from "../_lib/session";
import ClientsClient, { type ClientItem } from "./ClientsClient";
import type { TrialCard, ActiveRow, Player, Parent, Prep } from "../AdminClient";
import type { MessageRow } from "@/components/MessageThread";

export const dynamic = "force-dynamic";

type SubscriptionRow = {
  id: string;
  player_id: string;
  status: string;
  cycle_lessons_delivered: number;
  cycle_cancels_used: number;
  created_at: string;
  waiting_on?: string;
};
type QuestRow = { player_id: string; quest_key: string };
type VodRow = { player_id: string; url: string; created_at: string };
type PrepRow = Prep & { player_id: string };
type MessageWithPlayer = MessageRow & { player_id: string };

const QUEST_TOTAL = 4;

export default async function AdminClientsPage() {
  const { supabase } = await requireCoachSession();

  const subsLookup = await supabase
    .from("subscriptions")
    .select(
      "id, player_id, status, cycle_lessons_delivered, cycle_cancels_used, created_at, waiting_on",
    )
    .order("created_at", { ascending: false });

  const subscriptions = (subsLookup.data ?? []) as SubscriptionRow[];
  const visible = subscriptions.filter(
    (s) =>
      s.status === "trial" ||
      s.status === "active" ||
      s.status === "past_due" ||
      s.status === "pending_cancel",
  );
  const playerIds = visible.map((s) => s.player_id);

  let players: Player[] = [];
  let parents: Parent[] = [];
  let quests: QuestRow[] = [];
  let vods: VodRow[] = [];
  let preps: PrepRow[] = [];
  let messages: MessageWithPlayer[] = [];
  if (playerIds.length > 0) {
    const playerLookup = await supabase
      .from("players")
      .select(
        "id, family_id, first_name, age, fortnite_username, discord_username, current_rank, platform, hours_per_week, discord_channel_url",
      )
      .in("id", playerIds);
    players = (playerLookup.data ?? []) as Player[];

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
    parents = (parentLookup.data ?? []) as Parent[];
    quests = (questLookup.data ?? []) as QuestRow[];
    vods = (vodLookup.data ?? []) as VodRow[];
    preps = (prepLookup.data ?? []) as PrepRow[];
    messages = (messageLookup.data ?? []) as MessageWithPlayer[];
  }

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
  const messagesByPlayer = new Map<string, MessageWithPlayer[]>();
  for (const m of messages) {
    const arr = messagesByPlayer.get(m.player_id) ?? [];
    arr.push(m);
    messagesByPlayer.set(m.player_id, arr);
  }

  const items: ClientItem[] = visible
    .map<ClientItem | null>((sub) => {
      const player = playersById.get(sub.player_id);
      if (!player) return null;
      const parent = parentByFamily.get(player.family_id);
      const completed = questsByPlayer.get(sub.player_id) ?? new Set<string>();
      const waitingOnTim = sub.waiting_on === "TIM";

      const phase =
        sub.status === "trial"
          ? "trial"
          : sub.status === "past_due"
            ? "past_due"
            : sub.status === "pending_cancel"
              ? "pending_cancel"
              : "active";

      const trial: TrialCard | undefined =
        sub.status === "trial"
          ? {
              subscription_id: sub.id,
              player_id: sub.player_id,
              player,
              parent: parent ?? null,
              completed_quest_keys: Array.from(completed),
              latest_vod_url: vodByPlayer.get(sub.player_id) ?? null,
              prep: prepByPlayer.get(sub.player_id) ?? null,
              messages: messagesByPlayer.get(sub.player_id) ?? [],
              created_at: sub.created_at,
            }
          : undefined;

      const active: ActiveRow | undefined =
        sub.status !== "trial"
          ? {
              subscription_id: sub.id,
              player_id: sub.player_id,
              player_first_name: player.first_name,
              parent_first_name: parent?.first_name ?? "(unknown)",
              status: sub.status,
              cycle_lessons_delivered: sub.cycle_lessons_delivered,
              cycle_cancels_used: sub.cycle_cancels_used,
              messages: messagesByPlayer.get(sub.player_id) ?? [],
            }
          : undefined;

      return {
        player_id: sub.player_id,
        kid_first_name: player.first_name,
        parent_first_name: parent?.first_name ?? "(unknown)",
        phase,
        waiting_on_tim: waitingOnTim,
        cycle_lessons: sub.cycle_lessons_delivered,
        cycle_cancels: sub.cycle_cancels_used,
        prep_completed: completed.size,
        total_quests: QUEST_TOTAL,
        trial,
        active,
      };
    })
    .filter((x): x is ClientItem => x !== null);

  // Sort: waiting_on=TIM first, then phase urgency, then kid name.
  const PHASE_PRIORITY: Record<ClientItem["phase"], number> = {
    past_due: 0,
    pending_cancel: 1,
    trial: 2,
    active: 3,
  };
  items.sort((a, b) => {
    if (a.waiting_on_tim !== b.waiting_on_tim) return a.waiting_on_tim ? -1 : 1;
    const pa = PHASE_PRIORITY[a.phase];
    const pb = PHASE_PRIORITY[b.phase];
    if (pa !== pb) return pa - pb;
    return a.kid_first_name.localeCompare(b.kid_first_name);
  });

  return <ClientsClient items={items} />;
}
