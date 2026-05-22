// /admin/inbox — Tim's cross-client message inbox.
//
// Replaces the prior stub. The client-card MessageThread on
// /admin/clients is still where Tim can dash off a quick reply
// inline; this Inbox is the canonical interface when the operator
// wants to triage all conversations in one place. The DB row (the
// messages table) is the single source of truth for both surfaces.
//
// Layout: list on the left (every player ordered by latest activity),
// detail on the right when a player is selected via ?client=<id>.
// On mobile the list collapses to a header strip; the detail
// occupies the full surface when a client is selected.

import { requireCoachSession } from "../_lib/session";
import InboxClient from "./InboxClient";
import type { ViewerRole } from "@/components/MessageThread";

export const dynamic = "force-dynamic";

type PlayerLookup = {
  id: string;
  first_name: string;
  family_id: string;
};

type ParentLookup = {
  family_id: string;
  first_name: string;
  email: string;
};

type LatestMessageLookup = {
  id: string;
  player_id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
  created_at: string;
  read_by_recipient_at: string | null;
};

type UnreadRow = { player_id: string };

type MessageRow = {
  id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
  created_at: string;
  read_by_recipient_at?: string | null;
  read_by_parent_at?: string | null;
};

export type InboxListItem = {
  player_id: string;
  kid_first_name: string;
  parent_first_name: string;
  parent_email: string;
  latest_message: {
    body: string;
    sender_role: "coach" | "player" | "bot";
    created_at: string;
  } | null;
  unread_count: number;
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const selectedPlayerId = client ?? null;

  const { supabase, coach } = await requireCoachSession();

  // 1. Active subscriptions only. Players whose subscription is
  //    `canceled` (parent ended) or `declined` (Tim said no at Stage C)
  //    are excluded from the inbox entirely — they don't appear in
  //    the list AND deep-link URLs to their threads show the empty
  //    state. Their messages persist in the DB for audit + future
  //    re-engagement (no hard delete, no soft delete column —
  //    filtered at the query layer only). If a family later returns,
  //    flipping subscription.status back to a non-terminal value
  //    surfaces the full history automatically with no data migration.
  //    For direct audit access while inactive, query the messages
  //    table via the Supabase SQL Editor.
  type ActiveSubLookup = { player_id: string };
  const activeSubResp = await supabase
    .from("subscriptions")
    .select("player_id")
    .not("status", "in", "(canceled,declined)");
  const activePlayerIds = new Set(
    ((activeSubResp.data ?? []) as ActiveSubLookup[]).map((s) => s.player_id),
  );

  // 2. Every player + family parent (sender of the parent-side view),
  //    filtered to those whose subscription is still active.
  const playersResp = await supabase
    .from("players")
    .select("id, first_name, family_id");
  const allPlayers = (playersResp.data ?? []) as PlayerLookup[];
  const players = allPlayers.filter((p) => activePlayerIds.has(p.id));

  if (players.length === 0) {
    return (
      <InboxClient
        coachId={coach.id}
        items={[]}
        selectedPlayerId={null}
        selectedThread={null}
        selectedHeader={null}
      />
    );
  }

  const familyIds = Array.from(new Set(players.map((p) => p.family_id)));
  const parentsResp = await supabase
    .from("parents")
    .select("family_id, first_name, email")
    .in("family_id", familyIds);
  const parents = (parentsResp.data ?? []) as ParentLookup[];
  const parentByFamily = new Map<string, ParentLookup>();
  for (const p of parents) parentByFamily.set(p.family_id, p);

  // 2. Latest message per player (DISTINCT ON player_id ORDER BY
  //    created_at DESC equivalent — we fetch a window then reduce
  //    client-side because supabase-js doesn't expose DISTINCT ON).
  //    At our scale (<= 12 clients) this is trivial; revisit when a
  //    real volume threshold matters.
  const playerIds = players.map((p) => p.id);
  const latestResp = await supabase
    .from("messages")
    .select("id, player_id, sender_role, body, created_at, read_by_recipient_at")
    .in("player_id", playerIds)
    .order("created_at", { ascending: false })
    .limit(500);
  const allLatestRows = (latestResp.data ?? []) as LatestMessageLookup[];
  const latestByPlayer = new Map<string, LatestMessageLookup>();
  for (const row of allLatestRows) {
    if (!latestByPlayer.has(row.player_id)) {
      latestByPlayer.set(row.player_id, row);
    }
  }

  // 3. Unread count per player. Kid messages waiting on Tim that the
  //    coach hasn't viewed yet (read_by_recipient_at IS NULL).
  const unreadResp = await supabase
    .from("messages")
    .select("player_id")
    .in("player_id", playerIds)
    .eq("sender_role", "player")
    .is("read_by_recipient_at", null);
  const unreadRows = (unreadResp.data ?? []) as UnreadRow[];
  const unreadByPlayer = new Map<string, number>();
  for (const row of unreadRows) {
    unreadByPlayer.set(row.player_id, (unreadByPlayer.get(row.player_id) ?? 0) + 1);
  }

  // 4. Stitch into the list shape the client component expects.
  const items: InboxListItem[] = players.map((p) => {
    const parent = parentByFamily.get(p.family_id);
    const latest = latestByPlayer.get(p.id);
    return {
      player_id: p.id,
      kid_first_name: p.first_name,
      parent_first_name: parent?.first_name ?? "",
      parent_email: parent?.email ?? "",
      latest_message: latest
        ? {
            body: latest.body,
            sender_role: latest.sender_role,
            created_at: latest.created_at,
          }
        : null,
      unread_count: unreadByPlayer.get(p.id) ?? 0,
    };
  });

  // 5. Sort. Conversations with activity bubble to the top by latest
  //    message DESC; silent threads sink to the bottom in alpha order.
  items.sort((a, b) => {
    const aHas = a.latest_message !== null;
    const bHas = b.latest_message !== null;
    if (aHas && bHas) {
      return (
        new Date(b.latest_message!.created_at).getTime() -
        new Date(a.latest_message!.created_at).getTime()
      );
    }
    if (aHas) return -1;
    if (bHas) return 1;
    return a.kid_first_name.localeCompare(b.kid_first_name);
  });

  // 6. Selected thread (full history for the right-hand panel).
  let selectedThread: MessageRow[] | null = null;
  let selectedHeader: InboxListItem | null = null;
  if (selectedPlayerId) {
    const match = items.find((i) => i.player_id === selectedPlayerId);
    if (match) {
      selectedHeader = match;
      const threadResp = await supabase
        .from("messages")
        .select(
          "id, sender_role, body, created_at, read_by_recipient_at, read_by_parent_at",
        )
        .eq("player_id", selectedPlayerId)
        .order("created_at", { ascending: true });
      selectedThread = (threadResp.data ?? []) as MessageRow[];
    }
  }

  return (
    <InboxClient
      coachId={coach.id}
      items={items}
      selectedPlayerId={selectedPlayerId}
      selectedThread={selectedThread}
      selectedHeader={selectedHeader}
    />
  );
}

// Re-exports so InboxClient doesn't have to redeclare these shapes.
export type { ViewerRole };
