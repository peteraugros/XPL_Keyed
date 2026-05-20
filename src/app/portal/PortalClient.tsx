"use client";

// Tiny Client Components used by the otherwise-server-rendered /portal page.
// SignOutButton hits the existing /api/auth/signout route then sends the
// parent back to /login. NudgeButton is intentionally inert for the first
// portal cut — it surfaces a "coming soon" toast via window.alert so the
// shape of the interaction is visible without a half-wired backend.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Even if the request fails, the session cookie may still be valid;
      // refresh to /login and let middleware sort it out.
    }
    (router.replace as (url: string) => void)("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={styles.signOutBtn}
    >
      {busy ? "Signing out..." : "Sign out"}
    </button>
  );
}

export function NudgeButton({
  questKey,
  kidFirstName,
}: {
  questKey: string;
  kidFirstName: string;
}) {
  function onClick() {
    window.alert(
      `Nudge by email is coming next phase. For now, hand ${kidFirstName} the device or open the player view together.`,
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.nudgeBtn}
      data-quest={questKey}
    >
      Nudge by email
    </button>
  );
}

// Parent-facing "open Stripe customer portal" CTA. POSTs to the
// billing-portal endpoint which creates a Stripe BillingPortal session
// tied to the family's Stripe Customer and returns the URL. The browser
// then redirects.
export function ManagePaymentButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/portal/billing-portal", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not open billing portal.");
        setBusy(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.playerLinkRow}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={styles.playerLinkBtn}
      >
        {busy ? "Opening..." : "Manage payment"}
      </button>
      {error ? <div className={styles.playerLinkError}>{error}</div> : null}
    </div>
  );
}

// Cancel + re-enable auto renew. Lives on /portal/billing. When the
// parent cancels, current cycle still completes through lesson 4; the
// next-cycle charge does not fire. Parent can re-enable any time the
// subscription is still active (i.e. before the cycle wraps and the
// cron transitions it to canceled).
export function AutoRenewToggle({
  initialAutoRenewEnabled,
  kidFirstName,
}: {
  initialAutoRenewEnabled: boolean;
  kidFirstName: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialAutoRenewEnabled);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doCancel() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/portal/subscription/cancel-auto-renew", {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not cancel auto renew.");
        setBusy(false);
        return;
      }
      setEnabled(false);
      setConfirming(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  async function doReenable() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/portal/subscription/reenable-auto-renew", {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not re-enable auto renew.");
        setBusy(false);
        return;
      }
      setEnabled(true);
      setBusy(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <div className={styles.playerLinkRow}>
        <div className={styles.playerLinkInfo}>
          Auto renew is off. {kidFirstName}&apos;s current cycle continues
          through lesson 4, then the subscription ends. No surprise charges.
        </div>
        <button
          type="button"
          onClick={doReenable}
          disabled={busy}
          className={styles.playerLinkBtn}
        >
          {busy ? "Re enabling..." : "Re enable auto renew"}
        </button>
        {error ? <div className={styles.playerLinkError}>{error}</div> : null}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className={styles.playerLinkRow}>
        <div className={styles.playerLinkInfo}>
          {kidFirstName}&apos;s current cycle still completes through lesson 4.
          No new charge fires. You can re-enable any time before the cycle
          wraps. After that, restart any time by booking a new cycle.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={doCancel}
            disabled={busy}
            className={styles.playerLinkBtn}
          >
            {busy ? "Cancelling..." : "Yes, cancel auto renew"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className={styles.playerLinkBtnSecondary ?? styles.playerLinkBtn}
            style={{ background: "transparent" }}
          >
            Never mind
          </button>
        </div>
        {error ? <div className={styles.playerLinkError}>{error}</div> : null}
      </div>
    );
  }

  return (
    <div className={styles.playerLinkRow}>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={styles.playerLinkBtn}
        style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
      >
        Cancel auto renew
      </button>
    </div>
  );
}

// Parent-facing "send the kid their sign-in link" CTA. The endpoint always
// sends to the authed parent's own email (no email is accepted from the
// client) so the trust gate stays tight.
export function SendPlayerLinkButton({
  kidFirstName,
  parentEmail,
}: {
  kidFirstName: string;
  parentEmail: string;
}) {
  type Stage = "idle" | "submitting" | "sent" | "error";
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setStage("submitting");
    try {
      const res = await fetch("/api/portal/send-player-link", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not send the link. Try again in a moment.");
        setStage("error");
        return;
      }
      setStage("sent");
    } catch {
      setError("Could not reach the server. Try again.");
      setStage("error");
    }
  }

  if (stage === "sent") {
    return (
      <div className={styles.playerLinkSent}>
        <div className={styles.playerLinkSentTitle}>Link sent to {parentEmail}</div>
        <div className={styles.playerLinkSentBody}>
          Forward the email to {kidFirstName}, or hand them the device and click
          the button in your inbox.
        </div>
        <button
          type="button"
          className={styles.playerLinkSecondaryBtn}
          onClick={() => {
            setStage("idle");
            setError(null);
          }}
        >
          Send another link
        </button>
      </div>
    );
  }

  return (
    <div className={styles.playerLinkRow}>
      <button
        type="button"
        className={styles.playerLinkBtn}
        onClick={onClick}
        disabled={stage === "submitting"}
      >
        {stage === "submitting" ? "Sending..." : `Send ${kidFirstName}'s sign in link to my email`}
      </button>
      {error ? <div className={styles.playerLinkError}>{error}</div> : null}
    </div>
  );
}
