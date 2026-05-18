// /curriculum/[token]/success
//
// Stripe redirects here after a successful checkout. We don't do DB writes
// here — the Stripe webhook handler is the canonical source of truth for
// state transitions (subscription.status='active', curricula.status='active',
// cycle_started_at=NOW()). This page is just a confirmation surface.
//
// The webhook fires near-simultaneously with this redirect. There's a
// small race where the parent might land here before the webhook has
// finished processing; in that case the "Open your dashboard" button is
// still the right action — by the time they click through, the state has
// usually flipped. If it hasn't, /portal still works (just shows the old
// trial-state UI for a beat, then the active-state branch).

import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default function CurriculumSuccessPage() {
  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <div className={styles.brand}>XPL KEYED</div>
        <div className={styles.card}>
          <div className={styles.eyebrow}>You&apos;re in</div>
          <h1 className={styles.headline}>Subscription locked in</h1>
          <p className={styles.body}>
            Thanks for approving the plan. Tim will start preparing your
            first lesson. The lesson drops on Sunday with a parent email
            translation alongside.
          </p>
          <p className={styles.body}>
            Sign in to your XPL Keyed dashboard to see the cycle progress
            and message Tim directly.
          </p>
          <a href="/portal" className={styles.primaryBtn}>Open your dashboard</a>
          <p className={styles.placeholderNote}>
            You can manage payment, see call recordings, and cancel any time
            from the dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
