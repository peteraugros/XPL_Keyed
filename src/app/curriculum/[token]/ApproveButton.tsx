"use client";

// Phase 2 entry. The Approve button hits /api/curriculum/[token]/approve
// (NOT the Stripe checkout endpoint anymore). The endpoint transitions
// the family's lifecycle_state to ACCEPTED_PENDING_SCHEDULING and
// returns a magic-link URL that signs the parent in and lands them on
// /portal/sessions. Stripe checkout is now invoked AFTER scheduling
// finishes (4 of 4 slots booked), from the Sessions surface.

import { useState } from "react";
import styles from "./page.module.css";

export default function ApproveButton({ token }: { token: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/curriculum/${token}/approve`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        redirect_url?: string;
        error?: string;
      };
      if (!res.ok || !body.redirect_url) {
        setError(body.error ?? "Could not approve the plan. Try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = body.redirect_url;
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
        {submitting ? "Opening scheduling..." : "Reserve lesson times"}
      </button>
      {error ? <div className={styles.errorNote}>{error}</div> : null}
    </div>
  );
}
