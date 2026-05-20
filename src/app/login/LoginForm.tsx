"use client";

import { useRef, useState } from "react";
import styles from "./page.module.css";

export type Role = "parent" | "player" | "coach";

const ERROR_COPY: Record<string, string> = {
  missing_code: "That sign in link was incomplete. Try again from the most recent email.",
  exchange_failed: "That sign in link could not be used. It may have expired. Request a new one below.",
  verify_failed: "That sign in link could not be used. It may have expired. Request a new one below.",
  set_session_failed: "That sign in link could not be used. It may have expired. Request a new one below.",
};

type Stage = "form" | "submitting" | "sent" | "error";

export default function LoginForm({
  initialRole,
  showCoachOption,
  next,
  callbackError,
}: {
  initialRole: Role;
  showCoachOption: boolean;
  next: string | null;
  callbackError: string | null;
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Hidden coach password panel. Reveal mechanism: triple-tap the brand
  // mark within 1.5 seconds. No visual hint that it exists — Tim knows
  // the trick.
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [secretUsername, setSecretUsername] = useState("");
  const [secretPassword, setSecretPassword] = useState("");
  const [secretSubmitting, setSecretSubmitting] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);
  const tapTimesRef = useRef<number[]>([]);

  function onBrandTap() {
    const now = Date.now();
    tapTimesRef.current = [...tapTimesRef.current.filter((t) => now - t < 1500), now];
    if (tapTimesRef.current.length >= 3) {
      setSecretRevealed(true);
      tapTimesRef.current = [];
    }
  }

  async function onSecretSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSecretError(null);
    if (!secretUsername.trim() || !secretPassword) {
      setSecretError("Type both fields.");
      return;
    }
    setSecretSubmitting(true);
    try {
      const res = await fetch("/api/auth/sign-in-coach-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: secretUsername.trim(),
          password: secretPassword,
          next: next ?? undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.next) {
        setSecretError(
          body.error === "invalid_credentials"
            ? "Wrong username or password."
            : "Sign in failed. Try again.",
        );
        setSecretSubmitting(false);
        return;
      }
      // Hard navigate so the freshly-set session cookies are picked up
      // on the next page render.
      window.location.href = body.next;
    } catch {
      setSecretError("Could not reach the server.");
      setSecretSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setStage("submitting");
    try {
      const res = await fetch("/api/auth/send-magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role, next: next ?? undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(
          body.error === "send_failed"
            ? "We could not send the email just now. Try again in a minute."
            : "Something went wrong on our end. Try again in a minute.",
        );
        setStage("error");
        return;
      }
      setStage("sent");
    } catch {
      setErrorMessage("We could not reach the server. Check your connection and try again.");
      setStage("error");
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <button
          type="button"
          className={styles.brand}
          onClick={onBrandTap}
          aria-label="XPL Keyed"
          style={{ background: "none", border: "none", cursor: "default", padding: 0 }}
        >
          XPL KEYED
        </button>

        {secretRevealed ? (
          <form className={styles.card} onSubmit={onSecretSubmit}>
            <h1 className={styles.headline}>Coach sign in</h1>
            <p className={styles.subtle}>Username and password.</p>
            {secretError ? <div className={styles.alert}>{secretError}</div> : null}
            <label className={styles.label} htmlFor="secret-username">
              Username
            </label>
            <input
              id="secret-username"
              type="text"
              autoComplete="username"
              className={styles.input}
              value={secretUsername}
              onChange={(e) => setSecretUsername(e.target.value)}
              placeholder="username"
              spellCheck={false}
              autoCapitalize="none"
              autoFocus
            />
            <label className={styles.label} htmlFor="secret-password">
              Password
            </label>
            <input
              id="secret-password"
              type="password"
              autoComplete="current-password"
              className={styles.input}
              value={secretPassword}
              onChange={(e) => setSecretPassword(e.target.value)}
              placeholder="password"
            />
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={secretSubmitting}
            >
              {secretSubmitting ? "Signing in..." : "Sign in"}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => {
                setSecretRevealed(false);
                setSecretUsername("");
                setSecretPassword("");
                setSecretError(null);
              }}
              disabled={secretSubmitting}
            >
              Back
            </button>
          </form>
        ) : null}

        {secretRevealed ? null : stage === "sent" ? (
          <div className={styles.card}>
            <h1 className={styles.headline}>Check your inbox</h1>
            <p className={styles.body}>
              {role === "parent"
                ? "We sent a sign in link to your email. It is good for one hour."
                : role === "player"
                  ? "We sent the sign in link to the parent email on file. It is good for one hour."
                  : "We sent a sign in link to your coach email. It is good for one hour."}
            </p>
            <p className={styles.subtle}>
              Did not get it? Check spam, or tap below to send another.
            </p>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setStage("form")}
            >
              Send another
            </button>
          </div>
        ) : (
          <form className={styles.card} onSubmit={onSubmit}>
            <h1 className={styles.headline}>Sign in</h1>
            <p className={styles.body}>
              We will email you a one tap sign in link. No password.
            </p>

            {callbackError && stage === "form" && !errorMessage ? (
              <div className={styles.alert}>
                {ERROR_COPY[callbackError] ?? "That sign in link did not work. Request a new one below."}
              </div>
            ) : null}
            {errorMessage ? <div className={styles.alert}>{errorMessage}</div> : null}

            <div className={styles.roleRow} role="radiogroup" aria-label="Who is signing in">
              <button
                type="button"
                role="radio"
                aria-checked={role === "parent"}
                className={`${styles.roleBtn} ${role === "parent" ? styles.roleBtnActive : ""}`}
                onClick={() => setRole("parent")}
              >
                Parent
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={role === "player"}
                className={`${styles.roleBtn} ${role === "player" ? styles.roleBtnActive : ""}`}
                onClick={() => setRole("player")}
              >
                Player
              </button>
              {showCoachOption ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={role === "coach"}
                  className={`${styles.roleBtn} ${role === "coach" ? styles.roleBtnActive : ""}`}
                  onClick={() => setRole("coach")}
                >
                  Coach
                </button>
              ) : null}
            </div>

            <label className={styles.label} htmlFor="email">
              {role === "parent"
                ? "Your email"
                : role === "player"
                  ? "Parent's email"
                  : "Your coach email"}
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                role === "parent"
                  ? "you@example.com"
                  : role === "player"
                    ? "your parent's email"
                    : "the email on your coach record"
              }
            />
            {role === "player" ? (
              <p className={styles.subtle}>
                The sign in link goes to your parent. They can hand you the device or forward the email.
              </p>
            ) : null}

            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={stage === "submitting" || !email.trim()}
            >
              {stage === "submitting" ? "Sending..." : "Email me the link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
