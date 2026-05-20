// Persistent footer panel per locked decision 8. Live counters surface
// current skip + cancel usage so families never have to memorize rules.
// Static policy copy below.
//
// Skip count is a placeholder zero until phase 3 ships the skip_events
// table. Cancel count reads from subscriptions.cycle_cancels_used.

import styles from "./sessions.module.css";

export default function SessionPolicyPanel({
  cycleCancelsUsed,
  skipsUsed,
}: {
  cycleCancelsUsed: number;
  skipsUsed: number;
}) {
  return (
    <section className={styles.policyCard}>
      <div className={styles.policyHeader}>
        <div>
          <div className={styles.policyEyebrow}>Your session policy</div>
          <div className={styles.policyTitle}>How skips, cancels, and rescheduling work</div>
        </div>
        <div className={styles.policyCounters}>
          <div className={styles.policyCounter}>
            <span className={styles.policyCounterLabel}>Skip</span>
            <span className={styles.policyCounterValue}>{skipsUsed} / 1</span>
          </div>
          <div className={styles.policyCounter}>
            <span className={styles.policyCounterLabel}>Cancels</span>
            <span className={styles.policyCounterValue}>{cycleCancelsUsed} / 2</span>
          </div>
        </div>
      </div>
      <ul className={styles.policyList}>
        <li>1 skip allowed per 4 session cycle</li>
        <li>Cancellations made under 24 hours count toward your cancellation limit</li>
        <li>After 3 late cancellations, subscription access may end</li>
        <li>Rescheduling is always preferred when possible</li>
      </ul>
    </section>
  );
}
