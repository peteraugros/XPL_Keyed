// /admin/money — revenue + payment health.
//
// Server-rendered. Pulls revenue from Stripe (canonical) and the rest
// from our DB (subscription state). At 1-10 client scale a fresh
// Stripe call per page load is fine; if rendering ever feels slow,
// 5-minute cache or a nightly snapshot table is the upgrade path.
//
// Out of scope for now (per spec, deferred):
//   * Operator payout history — needs a multi-operator schema first.
//   * Per-invoice drill-down — Stripe dashboard handles it better.

import { requireCoachSession } from "../_lib/session";
import { stripe } from "@/lib/stripe/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import styles from "./money.module.css";
import {
  RefundReviewSection,
  type PendingRefund,
  type ResolvedRefund,
} from "./RefundReview";

export const dynamic = "force-dynamic";

type SubRow = {
  id: string;
  player_id: string;
  status: string;
  lifecycle_state: string | null;
  past_due_started_at: string | null;
  cycle_started_at: string | null;
  cycle_lessons_delivered: number;
  auto_renew_enabled: boolean;
};
type PlayerRow = { id: string; first_name: string; family_id: string };
type FamilyRow = { id: string; stripe_customer_id: string | null };
type ParentRow = { family_id: string; first_name: string; email: string };

const CENTS_PER_DOLLAR = 100;
const CYCLE_AMOUNT_CENTS = 5600;
const SOON_EXPIRING_DAYS = 60;
const MONTHS_BACK = 6;

function fmtUsd(cents: number): string {
  return `$${(cents / CENTS_PER_DOLLAR).toFixed(0)}`;
}
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(
    new Date(y, m - 1, 1),
  );
}

export default async function MoneyPage() {
  // Coach gate
  await requireCoachSession();

  const supabase = createServiceRoleClient();

  // ---- Pull subscription state (service-role so we see all) ---------------
  const [subsResp, playersResp, familiesResp, parentsResp] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "id, player_id, status, lifecycle_state, past_due_started_at, cycle_started_at, cycle_lessons_delivered, auto_renew_enabled",
      ),
    supabase.from("players").select("id, first_name, family_id"),
    supabase.from("families").select("id, stripe_customer_id"),
    supabase.from("parents").select("family_id, first_name, email"),
  ]);

  const subs = (subsResp.data ?? []) as SubRow[];
  const players = (playersResp.data ?? []) as PlayerRow[];
  const families = (familiesResp.data ?? []) as FamilyRow[];
  const parents = (parentsResp.data ?? []) as ParentRow[];

  const playerById = new Map(players.map((p) => [p.id, p]));
  const familyById = new Map(families.map((f) => [f.id, f]));
  const parentByFamily = new Map(parents.map((p) => [p.family_id, p]));

  // ---- Headline counts ----------------------------------------------------
  const activeSubs = subs.filter((s) => s.status === "active");
  const payingSubs = activeSubs.filter((s) => s.lifecycle_state === "ACTIVE");
  const pastDueSubs = subs.filter((s) => s.status === "past_due");
  const autoRenewOffSubs = activeSubs.filter((s) => !s.auto_renew_enabled);

  // Avg cycle duration (operational health snapshot). For each paying
  // sub with a cycle_started_at, compute weeks elapsed. Average. If
  // most cycles are running 4-6 weeks the avg sits near 5; drag-out
  // pushes it higher. Snapshot of currently-active cycles, not history.
  const cycleAges = payingSubs
    .map((s) =>
      s.cycle_started_at
        ? (Date.now() - new Date(s.cycle_started_at).getTime()) / (7 * 86_400_000)
        : null,
    )
    .filter((n): n is number => n !== null);
  const avgCycleWeeks =
    cycleAges.length > 0
      ? cycleAges.reduce((sum, n) => sum + n, 0) / cycleAges.length
      : null;
  const draggingCycles = cycleAges.filter((n) => n > 8).length;

  // MRR-equivalent: each active sub renews ~every 4 weeks at $56, so the
  // 4-week run rate is straightforward. Calling it "Cycle run rate"
  // rather than MRR to avoid the 30-day connotation.
  const cycleRunRateCents = payingSubs.length * CYCLE_AMOUNT_CENTS;

  // ---- Stripe: revenue history + recent events ----------------------------
  // Last 6 months of paid charges. Stripe's PaymentIntent list is
  // simplest; paginate up to 100 per page, walk until we hit the cutoff.
  const cutoffSec = Math.floor(
    (Date.now() - MONTHS_BACK * 31 * 86_400_000) / 1000,
  );

  type RevByMonth = Map<string, number>;
  const revByMonth: RevByMonth = new Map();
  const recentPayments: Array<{
    id: string;
    created: number;
    amount: number;
    kid_first_name: string | null;
    description: string | null;
  }> = [];

  let stripeError: string | null = null;
  try {
    // Iterate with pagination. Stripe's auto-paginator can be heavy; for
    // 6 months at 1-10 clients we'll be under one page anyway.
    let starting_after: string | undefined;
    let pageCount = 0;
    while (pageCount < 10) {
      const page = await stripe.paymentIntents.list({
        limit: 100,
        created: { gte: cutoffSec },
        expand: ["data.latest_charge"],
        ...(starting_after ? { starting_after } : {}),
      });
      for (const pi of page.data) {
        if (pi.status !== "succeeded") continue;
        // Use net revenue: subtract any refunded amount from the charge.
        // A fully refunded charge nets to 0 and is skipped entirely.
        const charge = pi.latest_charge as
          | { refunded: boolean; amount_refunded: number; amount: number }
          | string
          | null;
        const refundedCents =
          typeof charge === "object" && charge !== null ? charge.amount_refunded : 0;
        const netCents = pi.amount - refundedCents;
        if (netCents <= 0) continue;
        const created = pi.created;
        const d = new Date(created * 1000);
        const key = monthKey(d);
        revByMonth.set(key, (revByMonth.get(key) ?? 0) + netCents);

        // Resolve kid first name for the description column (best-effort).
        const playerId = pi.metadata?.player_id ?? null;
        const kid = playerId ? playerById.get(playerId)?.first_name ?? null : null;
        recentPayments.push({
          id: pi.id,
          created,
          amount: netCents,
          kid_first_name: kid,
          description:
            pi.description ?? (pi.metadata?.kind === "renewal" ? "Cycle renewal" : "First cycle"),
        });
      }
      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1]?.id;
      pageCount += 1;
    }
  } catch (err) {
    stripeError = err instanceof Error ? err.message : "stripe_unavailable";
    console.error("[admin/money] Stripe revenue query failed", err);
  }

  // Build the bar chart series — fill missing months with 0.
  const now = new Date();
  const monthSeries: Array<{ key: string; label: string; cents: number }> = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    monthSeries.push({ key, label: monthLabel(key), cents: revByMonth.get(key) ?? 0 });
  }
  const maxMonthCents = monthSeries.reduce((m, s) => Math.max(m, s.cents), 0);
  const ytdCents = monthSeries
    .filter((s) => s.key.startsWith(String(now.getFullYear())))
    .reduce((sum, s) => sum + s.cents, 0);
  const mtdCents = monthSeries[monthSeries.length - 1]?.cents ?? 0;

  recentPayments.sort((a, b) => b.created - a.created);
  const recentTop = recentPayments.slice(0, 10);

  // ---- Stripe: payment-method health (cards expiring soon) ----------------
  type ExpiringCard = {
    family_id: string;
    kid_first_name: string | null;
    parent_first_name: string | null;
    parent_email: string | null;
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
    days_until_expiry: number;
  };
  const expiringCards: ExpiringCard[] = [];

  const familiesWithCustomer = families.filter((f) => !!f.stripe_customer_id);
  try {
    for (const family of familiesWithCustomer) {
      const player = players.find((p) => p.family_id === family.id);
      if (!player) continue;
      const parent = parentByFamily.get(family.id);
      const pms = await stripe.paymentMethods.list({
        customer: family.stripe_customer_id!,
        type: "card",
        limit: 5,
      });
      for (const pm of pms.data) {
        const card = pm.card;
        if (!card) continue;
        // Last day of the expiry month, end of day UTC.
        const expDate = new Date(Date.UTC(card.exp_year, card.exp_month, 0, 23, 59, 59));
        const daysUntil = Math.floor((expDate.getTime() - Date.now()) / 86_400_000);
        if (daysUntil < 0 || daysUntil > SOON_EXPIRING_DAYS) continue;
        expiringCards.push({
          family_id: family.id,
          kid_first_name: player.first_name,
          parent_first_name: parent?.first_name ?? null,
          parent_email: parent?.email ?? null,
          brand: card.brand,
          last4: card.last4,
          exp_month: card.exp_month,
          exp_year: card.exp_year,
          days_until_expiry: daysUntil,
        });
      }
    }
    expiringCards.sort((a, b) => a.days_until_expiry - b.days_until_expiry);
  } catch (err) {
    console.error("[admin/money] Stripe PM query failed", err);
  }

  // ---- Past-due families (derived from DB, not Stripe) --------------------
  type PastDueRow = {
    subscription_id: string;
    player_id: string;
    kid_first_name: string;
    parent_first_name: string | null;
    days_past_due: number;
  };
  const pastDueRows: PastDueRow[] = [];
  for (const s of pastDueSubs) {
    const player = playerById.get(s.player_id);
    if (!player) continue;
    const parent = parentByFamily.get(player.family_id);
    pastDueRows.push({
      subscription_id: s.id,
      player_id: s.player_id,
      kid_first_name: player.first_name,
      parent_first_name: parent?.first_name ?? null,
      days_past_due: s.past_due_started_at ? daysSince(s.past_due_started_at) : 0,
    });
  }
  pastDueRows.sort((a, b) => b.days_past_due - a.days_past_due);

  // ---- Refund requests (DB) -----------------------------------------------
  type RefundRow = {
    id: string;
    family_id: string;
    subscription_id: string;
    status: "pending" | "approved" | "denied";
    amount_cents: number;
    charge_date: string;
    reason: string;
    decision_note: string | null;
    decided_at: string | null;
    created_at: string;
  };
  // refund_requests landed in 20260525000300 (not in db.ts until regen).
  const refundRowsResp = await supabase
    .from("refund_requests" as never)
    .select(
      "id, family_id, subscription_id, status, amount_cents, charge_date, reason, decision_note, decided_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  const refundRows = ((refundRowsResp.data ?? []) as unknown) as RefundRow[];

  // We need kid + parent context per refund row. Resolve via the
  // already-loaded maps + a lookup from subscription -> player.
  const subById = new Map(subs.map((s) => [s.id, s]));
  function refundContext(r: RefundRow): {
    kid_first_name: string | null;
    parent_first_name: string | null;
    parent_email: string | null;
    player_id: string | null;
  } {
    const sub = subById.get(r.subscription_id);
    const player = sub ? playerById.get(sub.player_id) : null;
    const parent = parentByFamily.get(r.family_id);
    return {
      kid_first_name: player?.first_name ?? null,
      parent_first_name: parent?.first_name ?? null,
      parent_email: parent?.email ?? null,
      player_id: player?.id ?? null,
    };
  }
  const pendingRefunds: PendingRefund[] = refundRows
    .filter((r) => r.status === "pending")
    .map((r) => ({
      id: r.id,
      ...refundContext(r),
      amount_cents: r.amount_cents,
      charge_iso: r.charge_date,
      reason: r.reason,
      requested_iso: r.created_at,
    }));
  const resolvedRefunds: ResolvedRefund[] = refundRows
    .filter((r) => r.status !== "pending")
    .map((r) => ({
      id: r.id,
      kid_first_name: refundContext(r).kid_first_name,
      parent_first_name: refundContext(r).parent_first_name,
      amount_cents: r.amount_cents,
      charge_iso: r.charge_date,
      status: r.status as "approved" | "denied",
      decision_note: r.decision_note,
      decided_iso: r.decided_at,
    }));

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Money</div>
        <h1 className={styles.title}>Revenue and billing health</h1>
      </section>

      {/* Headline stats */}
      <section className={styles.statsGrid}>
        <Stat label="Paying clients" value={`${payingSubs.length} / 12`} />
        <Stat label="Cycle run rate" value={fmtUsd(cycleRunRateCents)} hint="If every paying client renews their current cycle." />
        <Stat label="This month" value={fmtUsd(mtdCents)} />
        <Stat label="Year to date" value={fmtUsd(ytdCents)} />
        <Stat label="Past due" value={String(pastDueSubs.length)} tone={pastDueSubs.length > 0 ? "warn" : undefined} />
        <Stat label="Auto renew off" value={String(autoRenewOffSubs.length)} tone={autoRenewOffSubs.length > 0 ? "muted" : undefined} />
        <Stat
          label="Avg cycle weeks"
          value={avgCycleWeeks !== null ? avgCycleWeeks.toFixed(1) : "—"}
          tone={avgCycleWeeks !== null && avgCycleWeeks > 6 ? "warn" : undefined}
          hint="Target is 4 weeks. Above 6 means drag-out is eating cycle frequency."
        />
        {draggingCycles > 0 ? (
          <Stat label="Dragging cycles" value={String(draggingCycles)} tone="warn" hint="Cycles running 8+ weeks." />
        ) : null}
        {pendingRefunds.length > 0 ? (
          <Stat
            label="Refunds pending"
            value={String(pendingRefunds.length)}
            tone="warn"
            hint="Awaiting your approve or deny."
          />
        ) : null}
      </section>

      {/* Revenue bar chart */}
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Last {MONTHS_BACK} months</div>
        <h2 className={styles.cardTitle}>Revenue by month</h2>
        {stripeError ? (
          <p className={styles.cardWarn}>
            Couldn&apos;t reach Stripe: {stripeError}. Other panels still show DB-derived state.
          </p>
        ) : null}
        <div className={styles.chart}>
          {monthSeries.map((m) => {
            const heightPct = maxMonthCents > 0 ? (m.cents / maxMonthCents) * 100 : 0;
            return (
              <div key={m.key} className={styles.chartCol}>
                <div className={styles.chartValue}>{m.cents > 0 ? fmtUsd(m.cents) : ""}</div>
                <div className={styles.chartBarTrack}>
                  <div
                    className={styles.chartBar}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <div className={styles.chartLabel}>{m.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Past-due families */}
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Dunning</div>
        <h2 className={styles.cardTitle}>Past due families</h2>
        {pastDueRows.length === 0 ? (
          <p className={styles.cardSubtle}>None right now. Every active card is current.</p>
        ) : (
          <ul className={styles.list}>
            {pastDueRows.map((r) => (
              <li key={r.subscription_id} className={styles.listRow}>
                <div className={styles.listMain}>
                  <a href={`/admin/clients?client=${r.player_id}`} className={styles.listName}>
                    {r.kid_first_name}
                  </a>
                  <span className={styles.listMeta}>
                    {r.parent_first_name ? `${r.parent_first_name}'s family · ` : null}
                    Day {r.days_past_due} past due
                  </span>
                </div>
                <span
                  className={`${styles.pill} ${r.days_past_due >= 7 ? styles.pillEpic : styles.pillLegendary}`}
                >
                  {r.days_past_due >= 14
                    ? "Auto end imminent"
                    : r.days_past_due >= 7
                      ? "Day 7+ reach out"
                      : "Stripe retrying"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Card expiry health */}
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Payment methods</div>
        <h2 className={styles.cardTitle}>Cards expiring within {SOON_EXPIRING_DAYS} days</h2>
        {expiringCards.length === 0 ? (
          <p className={styles.cardSubtle}>None. Every saved card is good for at least {SOON_EXPIRING_DAYS} more days.</p>
        ) : (
          <ul className={styles.list}>
            {expiringCards.map((c, i) => (
              <li key={`${c.family_id}-${i}`} className={styles.listRow}>
                <div className={styles.listMain}>
                  <span className={styles.listName}>
                    {c.kid_first_name}
                    {c.parent_first_name ? ` · ${c.parent_first_name}'s family` : null}
                  </span>
                  <span className={styles.listMeta}>
                    {c.brand.toUpperCase()} ending {c.last4}. Expires{" "}
                    {String(c.exp_month).padStart(2, "0")}/{String(c.exp_year).slice(-2)}.
                  </span>
                </div>
                <span
                  className={`${styles.pill} ${c.days_until_expiry <= 14 ? styles.pillEpic : styles.pillLegendary}`}
                >
                  {c.days_until_expiry <= 0
                    ? "Expires this month"
                    : `${c.days_until_expiry} days`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent payments */}
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Recent activity</div>
        <h2 className={styles.cardTitle}>Last 10 paid charges</h2>
        {recentTop.length === 0 ? (
          <p className={styles.cardSubtle}>No charges in the last {MONTHS_BACK} months.</p>
        ) : (
          <ul className={styles.list}>
            {recentTop.map((p) => (
              <li key={p.id} className={styles.listRow}>
                <div className={styles.listMain}>
                  <span className={styles.listName}>
                    {p.kid_first_name ?? "Unknown player"}
                  </span>
                  <span className={styles.listMeta}>
                    {p.description ?? ""} ·{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(new Date(p.created * 1000))}
                  </span>
                </div>
                <span className={styles.pillOk}>{fmtUsd(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RefundReviewSection pending={pendingRefunds} resolved={resolvedRefunds} />

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Coming later</div>
        <ul className={styles.bullets}>
          <li>Operator payout history (lands when the platform fee + Stripe Connect ship)</li>
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "muted";
  hint?: string;
}) {
  return (
    <div
      className={`${styles.stat} ${
        tone === "warn"
          ? styles.statWarn
          : tone === "muted"
            ? styles.statMuted
            : tone === "ok"
              ? styles.statOk
              : ""
      }`}
      title={hint}
    >
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}
