// /dad — Peter's admin surface
//
// Per Coach Dashboard Spec/dad-admin-spec.md. Phase 1: Stuck queue only.
// Operational alerts, Tim-today summary, business glance, and View-as-Tim
// are all deferred. This page is small on purpose: it exists so Peter can
// resolve the Stuck escalations Tim sends, nothing more for now.
//
// Auth gate: must be authenticated AND have coaches.is_dad = true. The
// existing /admin route handles is_active coach login (Tim); Dad gets a
// separate top-level route to keep the surfaces clean. Peter's coach row
// is both is_active and is_dad in local testing, so the same login serves
// both routes — he picks which one to visit.

import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DadClient from "./DadClient";
import styles from "./page.module.css";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

export const dynamic = "force-dynamic";

type CoachLookup = { id: string; display_name: string; is_dad: boolean };
type IdLookup = { id: string };

type StuckRow = {
  id: string;
  tim_user_id: string;
  object_type: string;
  object_id: string;
  reason: string | null;
  created_at: string;
};

type TimDadRow = {
  id: string;
  sender_role: "tim" | "dad";
  body: string;
  created_at: string;
};

export default async function DadPage() {
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) redirect("/login?next=/dad");

  const coachLookup = await supabase
    .from("coaches")
    .select("id, display_name, is_dad")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const coach = coachLookup.data as CoachLookup | null;
  if (!coach || !coach.is_dad) {
    // Not Dad. Bounce to whichever role they actually are.
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
    if (coach && !coach.is_dad) redirect("/admin");
    redirect("/login?error=no_role");
  }

  // Open stuck events, newest first.
  const stuckLookup = await supabase
    .from("stuck_events")
    .select("id, tim_user_id, object_type, object_id, reason, created_at")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  const stucks = (stuckLookup.data ?? []) as StuckRow[];

  // Resolve context per object_type. We bundle the source object + a
  // human-readable client name + minimal payload for the Dad UI to render.
  type StuckContext = {
    client_name: string | null;
    summary: string;
    extra: Record<string, string | null>;
  };
  const contexts = new Map<string, StuckContext>();

  // Pre-collect ids by type so we can batch.
  const messageIds = stucks.filter((s) => s.object_type === "message_thread").map((s) => s.object_id);
  const subIds = stucks
    .filter((s) => s.object_type === "trial_decision" || s.object_type === "dunning")
    .map((s) => s.object_id);
  const curriculumIds = stucks.filter((s) => s.object_type === "curriculum_approval").map((s) => s.object_id);
  const cancelIds = stucks.filter((s) => s.object_type === "cancellation_event").map((s) => s.object_id);

  // Messages → join to players
  if (messageIds.length > 0) {
    const msgs = await supabase
      .from("messages")
      .select("id, player_id, body, sender_role, created_at")
      .in("id", messageIds);
    const msgRows = (msgs.data ?? []) as Array<{
      id: string;
      player_id: string;
      body: string;
      sender_role: string;
      created_at: string;
    }>;
    const playerIds = Array.from(new Set(msgRows.map((m) => m.player_id)));
    const players =
      playerIds.length > 0
        ? await supabase.from("players").select("id, first_name").in("id", playerIds)
        : { data: [] };
    const playerById = new Map<string, string>();
    for (const p of (players.data ?? []) as Array<{ id: string; first_name: string }>) {
      playerById.set(p.id, p.first_name);
    }
    for (const m of msgRows) {
      const snippet = (m.body ?? "").trim().slice(0, 280);
      contexts.set(m.id, {
        client_name: playerById.get(m.player_id) ?? null,
        summary: `${m.sender_role === "player" ? "Kid" : "Tim"} message: "${snippet}${m.body.length > 280 ? "..." : ""}"`,
        extra: { sender_role: m.sender_role, message_age: m.created_at },
      });
    }
  }

  // Subscriptions (trial_decision / dunning)
  if (subIds.length > 0) {
    const subs = await supabase
      .from("subscriptions")
      .select("id, player_id, status, lifecycle_state")
      .in("id", subIds);
    const subRows = (subs.data ?? []) as Array<{
      id: string;
      player_id: string;
      status: string;
      lifecycle_state: string;
    }>;
    const pids = Array.from(new Set(subRows.map((s) => s.player_id)));
    const players =
      pids.length > 0
        ? await supabase.from("players").select("id, first_name").in("id", pids)
        : { data: [] };
    const playerById = new Map<string, string>();
    for (const p of (players.data ?? []) as Array<{ id: string; first_name: string }>) {
      playerById.set(p.id, p.first_name);
    }
    for (const s of subRows) {
      contexts.set(s.id, {
        client_name: playerById.get(s.player_id) ?? null,
        summary: `${s.lifecycle_state.replace(/_/g, " ").toLowerCase()} (sub status ${s.status})`,
        extra: { status: s.status, lifecycle_state: s.lifecycle_state },
      });
    }
  }

  // Curricula
  if (curriculumIds.length > 0) {
    const curs = await supabase
      .from("curricula")
      .select("id, player_id, status")
      .in("id", curriculumIds);
    const curRows = (curs.data ?? []) as Array<{
      id: string;
      player_id: string;
      status: string;
    }>;
    const pids = Array.from(new Set(curRows.map((c) => c.player_id)));
    const players =
      pids.length > 0
        ? await supabase.from("players").select("id, first_name").in("id", pids)
        : { data: [] };
    const playerById = new Map<string, string>();
    for (const p of (players.data ?? []) as Array<{ id: string; first_name: string }>) {
      playerById.set(p.id, p.first_name);
    }
    for (const c of curRows) {
      contexts.set(c.id, {
        client_name: playerById.get(c.player_id) ?? null,
        summary: `Curriculum ${c.status.replace(/_/g, " ")}`,
        extra: { status: c.status },
      });
    }
  }

  // Cancellation events
  if (cancelIds.length > 0) {
    const cancels = await supabase
      .from("cancellation_events")
      .select("id, subscription_id, classification, hours_until_call")
      .in("id", cancelIds);
    const cancelRows = (cancels.data ?? []) as Array<{
      id: string;
      subscription_id: string;
      classification: string;
      hours_until_call: number | null;
    }>;
    const subIdsFromCancels = Array.from(new Set(cancelRows.map((c) => c.subscription_id)));
    const subsForCancels =
      subIdsFromCancels.length > 0
        ? await supabase.from("subscriptions").select("id, player_id").in("id", subIdsFromCancels)
        : { data: [] };
    const subToPlayer = new Map<string, string>();
    for (const s of (subsForCancels.data ?? []) as Array<{ id: string; player_id: string }>) {
      subToPlayer.set(s.id, s.player_id);
    }
    const pids = Array.from(new Set(Array.from(subToPlayer.values())));
    const players =
      pids.length > 0
        ? await supabase.from("players").select("id, first_name").in("id", pids)
        : { data: [] };
    const playerById = new Map<string, string>();
    for (const p of (players.data ?? []) as Array<{ id: string; first_name: string }>) {
      playerById.set(p.id, p.first_name);
    }
    for (const c of cancelRows) {
      const playerId = subToPlayer.get(c.subscription_id) ?? "";
      contexts.set(c.id, {
        client_name: playerById.get(playerId) ?? null,
        summary: `Cancel: ${c.classification}${c.hours_until_call !== null ? ` (${c.hours_until_call.toFixed(0)}h until call)` : ""}`,
        extra: { classification: c.classification },
      });
    }
  }

  // Tim ↔ Dad channel — operator-to-operator 1:1 thread, shared with /admin.
  const timDadLookup = await supabase
    .from("tim_dad_messages")
    .select("id, sender_role, body, created_at")
    .order("created_at", { ascending: true })
    .limit(50);
  const timDadMessages = (timDadLookup.data ?? []) as TimDadRow[];

  // Pass everything to the client component for rendering.
  const queue = stucks.map((s) => ({
    id: s.id,
    object_type: s.object_type,
    object_id: s.object_id,
    reason: s.reason,
    created_at: s.created_at,
    context: contexts.get(s.object_id) ?? {
      client_name: null,
      summary: "(no context available)",
      extra: {},
    },
  }));

  return (
    <div className={styles.shell}>
      <DadClient
        dadName={coach.display_name}
        queue={queue}
        timDadMessages={timDadMessages}
      />
    </div>
  );
}
