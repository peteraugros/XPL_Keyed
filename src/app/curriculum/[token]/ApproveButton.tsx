"use client";

// Client wrapper around the Approve & Subscribe CTA. POSTs to the checkout
// endpoint, then redirects to Stripe's hosted Checkout page via the
// returned session URL. Stripe handles the payment UI; on completion they
// redirect back to /curriculum/[token]/success.

import { useState } from "react";
import styles from "./page.module.css";

export default function ApproveButton({ token }: { token: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/curriculum/${token}/checkout`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not start checkout. Try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={submitting}
        className={styles.primaryBtn}
      >
        {submitting ? "Opening checkout..." : "Approve plan and subscribe"}
      </button>
      {error ? <div className={styles.errorNote}>{error}</div> : null}
    </div>
  );
}
