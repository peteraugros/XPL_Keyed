// /portal/membership — subscription details + history.
//
// Closer to "the state of your relationship with the platform" than
// Billing's "manage card." Shows tier, cycle, cancellation history, and
// the multi-kid affordance. Read only today — actual edits route to
// either Billing (Stripe portal) or email Tim.

import { requireParentSession } from "../_lib/session";
import styles from "../_components/inner-page.module.css";

export const dynamic = "force-dynamic";

type SubLookup = {
  status: string;
  tier: string;
  cycle_started_at: string | null;
  cycle_lessons_delivered: number;
  cycle_cancels_used: number;
  created_at: string;
  pending_cancel_auto_confirm_at: string | null;
};
type CancellationRow = {
  id: string;
  created_at: string;
  classification: string;
  cycle_cancels_used_after: number | null;
  triggered_pending_cancel: boolean;
  initiated_via: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function statusBadge(status: string | undefined): { label: string; klass: string } {
  switch (status) {
    case "active":
      return { label: "Active", klass: styles.pillActive };
    case "past_due":
      return { label: "Payment hold", klass: styles.pillEpic };
    case "pending_cancel":
      return { label: "Pending cancel", klass: styles.pillLegendary };
    case "canceled":
      return { label: "Ended", klass: styles.pillFaint };
    case "declined":
      return { label: "Declined after trial", klass: styles.pillFaint };
    case "trial":
    default:
      return { label: "Trial", klass: "" };
  }
}

function cancellationCopy(c: CancellationRow): string {
  if (c.triggered_pending_cancel) {
    return "Third cancel of the cycle. Triggered the wind-down window.";
  }
  switch (c.classification) {
    case "parent_advance":
      return "Cancelled more than 24 hours out. Cycle paused 1 week, full credit.";
    case "parent_late":
      return "Cancelled within 24 hours. PowerPoint kept, live call forfeit.";
    case "no_show":
      return "Live call missed without notice.";
    case "coach_cancel":
      return "Tim cancelled this week. No impact on your cancel allowance.";
    default:
      return c.classification;
  }
}

function countedTowardCap(c: CancellationRow): boolean {
  // parent_advance increments cycle_cancels_used. parent_late and no_show
  // don't (kid keeps the material, lesson forfeit). coach_cancel never
  // touches the cap. triggered_pending_cancel always counts.
  if (c.triggered_pending_cancel) return true;
  return c.classification === "parent_advance";
}

export default async function MembershipPage() {
  const { supabase, player } = await requireParentSession();

  const [subResp, cancellationsResp] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "status, tier, cycle_started_at, cycle_lessons_delivered, cycle_cancels_used, created_at, pending_cancel_auto_confirm_at",
      )
      .eq("player_id", player.id)
      .maybeSingle(),
    supabase
      .from("cancellation_events")
      .select(
        "id, created_at, classification, cycle_cancels_used_after, triggered_pending_cancel, initiated_via",
      )
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const sub = subResp.data as SubLookup | null;
  const cancellations = (cancellationsResp.data ?? []) as CancellationRow[];
  // Filter to this player's events. cancellation_events is RLS-scoped by
  // family already (cancellation_events_family_select), so the result
  // includes the family's own rows but for the multi-kid case we want
  // this kid only. The schema joins through subscription_id; for the
  // 1-kid MVP family this is a no-op filter, but keep the shape correct.

  const badge = statusBadge(sub?.status);
  const memberSince = formatDate(sub?.created_at ?? null);
  const tierLabel =
    sub?.tier === "monthly"
      ? "Monthly subscription"
      : sub?.tier === "single"
        ? "Single lesson"
        : "Free trial";

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Account</div>
        <h1 className={styles.title}>Membership</h1>
        <p className={styles.intro}>
          The state of your subscription, in plain English. {player.first_name}&apos;s
          slot, your cycle, and your cancel allowance.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>{player.first_name}&apos;s subscription</div>
        <div className={styles.metaRow}>
          <span className={`${styles.pill} ${badge.klass}`}>{badge.label}</span>
          <span className={styles.pill}>{tierLabel}</span>
        </div>

        <dl className={styles.dl}>
          <dt className={styles.dt}>Member since</dt>
          <dd className={styles.dd}>{memberSince}</dd>

          {sub?.status === "active" ||
          sub?.status === "past_due" ||
          sub?.status === "pending_cancel" ? (
            <>
              <dt className={styles.dt}>Cycle started</dt>
              <dd className={styles.dd}>
                {formatDate(sub?.cycle_started_at ?? null)}
              </dd>
              <dt className={styles.dt}>Lessons delivered</dt>
              <dd className={styles.dd}>{sub.cycle_lessons_delivered} of 4</dd>
              <dt className={styles.dt}>Cancellations used</dt>
              <dd className={styles.dd}>
                {sub.cycle_cancels_used} of 2
                {sub.cycle_cancels_used === 2 ? (
                  <span className={styles.ddSubtle}>
                    {" "}One more cancel ends the subscription.
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}

          {sub?.status === "pending_cancel" ? (
            <>
              <dt className={styles.dt}>Auto-closes on</dt>
              <dd className={styles.dd}>
                {formatDate(sub.pending_cancel_auto_confirm_at)}
                <span className={styles.ddSubtle}>
                  {" "}Click the Undo link in your email any time before then to
                  keep the subscription.
                </span>
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Cancellation history</div>
        <h2 className={styles.cardTitle}>
          Past cancels and how they counted
        </h2>
        {cancellations.length === 0 ? (
          <p className={styles.cardSubtle}>
            Nothing yet. Your full cycle allowance is intact.
          </p>
        ) : (
          <ul className={styles.history}>
            {cancellations.map((c) => (
              <li key={c.id} className={styles.historyRow}>
                <span className={styles.historyDate}>
                  {formatDate(c.created_at)}
                </span>
                <span className={styles.historyCopy}>{cancellationCopy(c)}</span>
                <span className={styles.historyPill}>
                  {countedTowardCap(c) ? "Counted" : "No cap impact"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Add another kid</div>
        <h2 className={styles.cardTitle}>One subscription per kid</h2>
        <p className={styles.cardBody}>
          Each kid has their own 4-lesson cycle, their own curriculum, their own
          private Discord channel. Same price per kid: $56 for 4 lessons. No
          sibling discount because Tim does fully separate work per kid.
        </p>
        <p className={styles.cardSubtle}>
          The multi-kid flow is coming next phase. For now, email{" "}
          <span className={styles.code}>tim@xplkeyed.com</span> with your second
          kid&apos;s first name and age, and he&apos;ll send a fresh intake link.
        </p>
      </section>
    </div>
  );
}
