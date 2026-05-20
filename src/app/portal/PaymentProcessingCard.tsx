"use client";

// Thin transitional UI for /portal?welcome=1 when Stripe's redirect
// landed faster than our webhook. Polls the route every 2 seconds via
// router.refresh() until lifecycle flips to ACTIVE (at which point the
// enrolled banner takes over). Caps at ~30s; after that, the parent
// gets a soft "this is taking longer than usual" line + a manual
// retry. Per locked spec section 10a: no "confirming payment,"
// "charged successfully," or "refresh" language.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 30_000;

export default function PaymentProcessingCard({
  kidFirstName,
}: {
  kidFirstName: string;
}) {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - start > MAX_POLL_MS) {
        window.clearInterval(interval);
        setStalled(true);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [router]);

  return (
    <section className={styles.alertCelebrate}>
      <div className={styles.alertEyebrowCelebrate}>Setting up</div>
      <h2 className={styles.alertTitleLarge}>
        Setting up {kidFirstName}&apos;s enrollment
      </h2>
      <p className={styles.alertBody}>
        {stalled
          ? `This is taking longer than usual. Tap below to check again.`
          : `Just a moment while everything locks in.`}
      </p>
      {stalled ? (
        <div className={styles.alertCtaRow}>
          <button
            type="button"
            className={styles.alertCta}
            onClick={() => router.refresh()}
          >
            Check again
          </button>
        </div>
      ) : null}
    </section>
  );
}
