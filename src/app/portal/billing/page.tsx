// /portal/billing — payment, invoices, saved card.
//
// State-aware: shows the right copy + the right CTA per subscription
// status. Manage payment opens the Stripe customer portal (real
// endpoint, already wired). Invoice history isn't queried here — Stripe
// portal already exposes it, and round-tripping to Stripe on every page
// render isn't worth the latency at 1-10 client scale.

import { requireParentSession } from "../_lib/session";
import { ManagePaymentButton, AutoRenewToggle } from "../PortalClient";
import styles from "../_components/inner-page.module.css";

export const dynamic = "force-dynamic";

type SubLookup = {
  status: string;
  tier: string;
  cycle_started_at: string | null;
  cycle_lessons_delivered: number;
  cycle_skips_used: number;
  past_due_started_at: string | null;
  pending_cancel_auto_confirm_at: string | null;
  auto_renew_enabled: boolean;
};
type FamilyLookup = { stripe_customer_id: string | null };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function statusLabel(status: string | undefined): { label: string; klass: string } {
  switch (status) {
    case "active":
      return { label: "Active", klass: styles.pillActive };
    case "past_due":
      return { label: "Payment hold", klass: styles.pillEpic };
    case "pending_cancel":
      return { label: "Pending cancel", klass: styles.pillLegendary };
    case "canceled":
      return { label: "Canceled", klass: styles.pillFaint };
    case "declined":
      return { label: "Declined", klass: styles.pillFaint };
    case "trial":
    default:
      return { label: "Trial", klass: "" };
  }
}

export default async function BillingPage() {
  const { supabase, parent, player } = await requireParentSession();

  const [subResp, familyResp] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "status, tier, cycle_started_at, cycle_lessons_delivered, cycle_skips_used, past_due_started_at, pending_cancel_auto_confirm_at, auto_renew_enabled",
      )
      .eq("player_id", player.id)
      .maybeSingle(),
    supabase
      .from("families")
      .select("stripe_customer_id")
      .eq("id", parent.family_id)
      .maybeSingle(),
  ]);

  const sub = subResp.data as SubLookup | null;
  const family = familyResp.data as FamilyLookup | null;
  const hasStripeCustomer = !!family?.stripe_customer_id;

  const { label: statusText, klass: statusKlass } = statusLabel(sub?.status);
  const isPaying =
    sub?.status === "active" ||
    sub?.status === "past_due" ||
    sub?.status === "pending_cancel";
  const cycleStarted = formatDate(sub?.cycle_started_at ?? null);
  const pastDueSince = formatDate(sub?.past_due_started_at ?? null);
  const cancelsBy = formatDate(sub?.pending_cancel_auto_confirm_at ?? null);

  const tierLabel = (() => {
    if (sub?.tier === "monthly") return "Monthly subscription";
    if (sub?.tier === "single") return "Single lesson";
    return "Free trial";
  })();

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Account</div>
        <h1 className={styles.title}>Billing</h1>
        <p className={styles.intro}>
          Payment, invoices, and your saved card. Cancel any time. Your
          account and message history stay open if you do.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Current state</div>
        <div className={styles.metaRow}>
          <span className={`${styles.pill} ${statusKlass}`}>{statusText}</span>
          <span className={styles.pill}>{tierLabel}</span>
          {sub?.tier === "monthly" && isPaying ? (
            <span className={styles.pill}>$56 every 4 lessons</span>
          ) : null}
        </div>

        <dl className={styles.dl}>
          {cycleStarted ? (
            <>
              <dt className={styles.dt}>Cycle started</dt>
              <dd className={styles.dd}>{cycleStarted}</dd>
            </>
          ) : null}
          {isPaying ? (
            <>
              <dt className={styles.dt}>Lessons this cycle</dt>
              <dd className={styles.dd}>
                {sub?.cycle_lessons_delivered ?? 0} of 4
              </dd>
              <dt className={styles.dt}>Skips used</dt>
              <dd className={styles.dd}>
                {sub?.cycle_skips_used ?? 0} of 2
              </dd>
              <dt className={styles.dt}>Auto renew</dt>
              <dd className={styles.dd}>
                {sub?.auto_renew_enabled ? "On" : "Off"}
              </dd>
            </>
          ) : null}
          {sub?.status === "past_due" && pastDueSince ? (
            <>
              <dt className={styles.dt}>Payment hold since</dt>
              <dd className={styles.dd}>{pastDueSince}</dd>
            </>
          ) : null}
          {sub?.status === "pending_cancel" && cancelsBy ? (
            <>
              <dt className={styles.dt}>Closes on</dt>
              <dd className={styles.dd}>{cancelsBy}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Payment method</div>
        <h2 className={styles.cardTitle}>
          {sub?.status === "past_due"
            ? "Update your card to resume lessons"
            : "Manage your card and invoices"}
        </h2>
        <p className={styles.cardBody}>
          The secure Stripe customer portal handles card updates and invoice
          downloads. We don&apos;t see your card details on our side.
        </p>
        {hasStripeCustomer ? (
          <ManagePaymentButton />
        ) : (
          <p className={styles.cardSubtle}>
            Stripe customer record will be created the moment you subscribe
            after the trial call.
          </p>
        )}
      </section>

      {sub?.status === "active" ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Cancellation</div>
          <h2 className={styles.cardTitle}>
            {sub.auto_renew_enabled
              ? "End after current cycle"
              : "Auto renew is off"}
          </h2>
          {sub.auto_renew_enabled ? (
            <ul className={styles.bullets}>
              <li>
                {player.first_name}&apos;s current cycle still completes through
                lesson 4.
              </li>
              <li>No further charge after this cycle.</li>
              <li>
                Account stays active. Progress and messages are preserved.
              </li>
              <li>Restart any time by booking a new cycle.</li>
            </ul>
          ) : (
            <p className={styles.cardBody}>
              The current cycle finishes through lesson 4 either way. Re enable
              below to keep things running after that, or let it end naturally.
            </p>
          )}
          <AutoRenewToggle
            initialAutoRenewEnabled={sub.auto_renew_enabled}
            kidFirstName={player.first_name}
          />
        </section>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>How billing works</div>
        <ul className={styles.bullets}>
          <li>$56 for 4 lessons. One lesson drops every Sunday.</li>
          <li>
            The next $56 charge fires after the 4th lesson lands, not every 30
            days.
          </li>
          <li>
            If a week is paused (illness, vacation, coach time off), the cycle
            pauses too. You are never charged for lessons you did not get.
          </li>
          <li>
            Up to 2 skips per 4 lesson cycle. A 3rd skip turns off auto renew
            automatically.
          </li>
          <li>
            If a card declines, the cycle freezes. Stripe retries automatically.
            No new lessons run until payment is sorted.
          </li>
          <li>Cancel any time from this page. Current cycle still completes.</li>
        </ul>
      </section>
    </div>
  );
}
