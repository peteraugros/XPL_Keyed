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
import { stripe } from "@/lib/stripe/server";
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

export type NotificationRow = {
  id: string;
  channel: string;
  trigger: string;
  recipient_type: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
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

  // ---------------------------------------------------------------------------
  // Phase 2: Tim activity, business glance, operational alerts.
  // ---------------------------------------------------------------------------
  const now = new Date();
  const startOfTodayIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const twentyFourHoursAgoIso = new Date(now.getTime() - 86_400_000).toISOString();

  // Tim activity — counts of coach actions in two windows.
  // Returns are .count via head: true (Supabase returns the count without rows).
  async function countSince(
    table: "messages" | "task_completions" | "curriculum_slots" | "coach_cancels",
    column: string,
    sinceIso: string,
    extraFilter?: { col: string; val: string },
  ): Promise<number> {
    let q = supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .gte(column, sinceIso);
    if (extraFilter) {
      q = q.eq(extraFilter.col, extraFilter.val);
    }
    const r = await q;
    return r.count ?? 0;
  }

  const [
    msgsToday,
    msgsWeek,
    tasksToday,
    tasksWeek,
    callsToday,
    callsWeek,
    noShowsToday,
    noShowsWeek,
    coachCancelsToday,
    coachCancelsWeek,
  ] = await Promise.all([
    countSince("messages", "created_at", startOfTodayIso, { col: "sender_role", val: "coach" }),
    countSince("messages", "created_at", sevenDaysAgoIso, { col: "sender_role", val: "coach" }),
    countSince("task_completions", "completed_at", startOfTodayIso),
    countSince("task_completions", "completed_at", sevenDaysAgoIso),
    countSince("curriculum_slots", "live_call_completed_at", startOfTodayIso),
    countSince("curriculum_slots", "live_call_completed_at", sevenDaysAgoIso),
    countSince("curriculum_slots", "no_show_at", startOfTodayIso),
    countSince("curriculum_slots", "no_show_at", sevenDaysAgoIso),
    countSince("coach_cancels", "created_at", startOfTodayIso),
    countSince("coach_cancels", "created_at", sevenDaysAgoIso),
  ]);

  // Business glance — paying clients + revenue + Stripe balance + next payout.
  const payingLookup = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("tier", "monthly");
  const payingCount = payingLookup.count ?? 0;
  const cycleMrrCents = payingCount * 5600;

  // Stripe slice. Wrapped in try/catch — local dev without Stripe set or
  // a Stripe-side outage shouldn't crash /dad.
  let last7DaysRevenueCents = 0;
  let stripeBalanceCents: number | null = null;
  let nextPayoutCents: number | null = null;
  let nextPayoutDateIso: string | null = null;
  let stripeError: string | null = null;
  try {
    const since7Sec = Math.floor((now.getTime() - 7 * 86_400_000) / 1000);
    let starting: string | undefined;
    for (let pages = 0; pages < 5; pages++) {
      const resp = await stripe.paymentIntents.list({
        created: { gte: since7Sec },
        limit: 100,
        ...(starting ? { starting_after: starting } : {}),
      });
      for (const pi of resp.data) {
        if (pi.status === "succeeded") last7DaysRevenueCents += pi.amount;
      }
      if (!resp.has_more || resp.data.length === 0) break;
      starting = resp.data[resp.data.length - 1]?.id;
    }
    const balance = await stripe.balance.retrieve();
    stripeBalanceCents = balance.available.reduce((acc, b) => acc + b.amount, 0);
    const payouts = await stripe.payouts.list({ limit: 1, status: "pending" });
    const nextPayout = payouts.data[0];
    if (nextPayout) {
      nextPayoutCents = nextPayout.amount;
      nextPayoutDateIso = new Date(nextPayout.arrival_date * 1000).toISOString();
    }
  } catch (err) {
    stripeError = (err as Error).message ?? "stripe_error";
    console.error("[dad] stripe error", err);
  }

  // Operational alerts — notification_log aggregates.
  // (a) 24h fail count + total count
  // (b) Last successful send per trigger (catches dead crons)
  const failed24Lookup = await supabase
    .from("notification_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", twentyFourHoursAgoIso);
  const failed24Count = failed24Lookup.count ?? 0;

  const sent24Lookup = await supabase
    .from("notification_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("created_at", twentyFourHoursAgoIso);
  const sent24Count = sent24Lookup.count ?? 0;

  // Recent runs per trigger. We grab the last 500 sent rows and reduce
  // to the max per trigger in JS. Avoids needing a DISTINCT ON view.
  const recentRunsLookup = await supabase
    .from("notification_log")
    .select("trigger, sent_at")
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(500);
  const recentRuns = (recentRunsLookup.data ?? []) as Array<{
    trigger: string;
    sent_at: string;
  }>;
  const lastRunByTrigger = new Map<string, string>();
  for (const r of recentRuns) {
    if (!lastRunByTrigger.has(r.trigger)) lastRunByTrigger.set(r.trigger, r.sent_at);
  }

  // Tim ↔ Dad channel — operator-to-operator 1:1 thread, shared with /admin.
  const timDadLookup = await supabase
    .from("tim_dad_messages")
    .select("id, sender_role, body, created_at")
    .order("created_at", { ascending: true })
    .limit(50);
  const timDadMessages = (timDadLookup.data ?? []) as TimDadRow[];

  // Recent system activity from notification_log (last 50 emails). Gives
  // Peter visibility into every transactional email the platform fires
  // so he can spot patterns (high failure rate, unexpected sends, etc).
  const notifLookup = await supabase
    .from("notification_log")
    .select(
      "id, channel, trigger, recipient_type, status, error_message, sent_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  const notifications = (notifLookup.data ?? []) as NotificationRow[];

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

  const activity = {
    messages_replied: { today: msgsToday, week: msgsWeek },
    tasks_completed: { today: tasksToday, week: tasksWeek },
    calls_done: { today: callsToday, week: callsWeek },
    no_shows: { today: noShowsToday, week: noShowsWeek },
    coach_cancels: { today: coachCancelsToday, week: coachCancelsWeek },
  };

  const business = {
    paying_clients: payingCount,
    cycle_mrr_cents: cycleMrrCents,
    last_7d_revenue_cents: last7DaysRevenueCents,
    stripe_balance_cents: stripeBalanceCents,
    next_payout_cents: nextPayoutCents,
    next_payout_date_iso: nextPayoutDateIso,
    stripe_error: stripeError,
  };

  const opAlerts = {
    sent_24h: sent24Count,
    failed_24h: failed24Count,
    last_run_by_trigger: Array.from(lastRunByTrigger.entries()).map(([trigger, sent_at]) => ({
      trigger,
      sent_at,
    })),
  };

  return (
    <div className={styles.shell}>
      <DadClient
        dadName={coach.display_name}
        queue={queue}
        timDadMessages={timDadMessages}
        notifications={notifications}
        activity={activity}
        business={business}
        opAlerts={opAlerts}
      />
    </div>
  );
}
