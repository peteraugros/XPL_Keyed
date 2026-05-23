// /single-session/success
//
// Landing page after Stripe Checkout completes. Server-rendered,
// intentionally minimal — the real activation lives in the Stripe
// webhook, which the parent doesn't see. This page just acknowledges
// the payment and points them at the next step (check email for a
// scheduling link, or sign in directly).
//
// Race note: Stripe redirects here BEFORE our webhook usually fires.
// We don't try to query the DB for "is your session active" — the
// honest answer is "your payment went through, more info incoming."

import Link from "next/link";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default function SingleSessionSuccessPage() {
  return (
    <main className={styles.page}>
      <section
        className={styles.hero}
        style={{ marginTop: 32, maxWidth: 520 }}
      >
        <div className={styles.eyebrow}>Payment received</div>
        <h1 className={styles.title}>You&apos;re booked.</h1>
        <p className={styles.subtitle}>
          The receipt and a scheduling link will land in your inbox in the
          next minute or two. From there you pick a time that works, and
          Tim takes it from there.
        </p>
      </section>

      <div
        className={styles.card}
        style={{ maxWidth: 520, margin: "16px auto 0" }}
      >
        <h2 className={styles.cardTitle}>What happens next</h2>
        <ol
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 14,
            color: "var(--text-dim)",
            lineHeight: 1.55,
          }}
        >
          <li>Email lands with a one-tap sign in link.</li>
          <li>
            Pick a time for the 30 minute Discord call from Tim&apos;s
            calendar.
          </li>
          <li>
            Tim sends the Discord server invite to the player before the
            call.
          </li>
          <li>
            Slides and voiceover drop into the player view after the call
            so they can review.
          </li>
        </ol>
      </div>

      <p
        style={{
          textAlign: "center",
          marginTop: 24,
          fontSize: 13,
          color: "var(--text-faint)",
        }}
      >
        Email not showing up? Check spam, or write{" "}
        <Link
          href={"mailto:tim@xplkeyed.com" as never}
          style={{ color: "var(--lime)" }}
        >
          tim@xplkeyed.com
        </Link>
        .
      </p>
    </main>
  );
}
