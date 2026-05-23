"use client";

// SingleSessionClient
// -------------------
// Single-page form for $24 single coaching session. Sections render
// linearly down the page (no XP bar / no levels — this is a purchase,
// not gamified onboarding). The COPPA gate for under-13 is inline:
// once age <13 is detected, parent must email-verify before submit
// proceeds. Reuses the same pending_intake_verifications mechanism
// as /intake.
//
// Submit → /api/single-session/submit returns a Stripe Checkout URL,
// which we redirect to via window.location.href.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogLesson } from "./page";
import styles from "./page.module.css";

const STORAGE_KEY = "xpl-single-session-v1";

const RANK_OPTIONS = [
  "Not ranked yet",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Elite",
  "Champion",
  "Unreal",
] as const;

const PLATFORM_OPTIONS = [
  "PC",
  "PlayStation",
  "Xbox",
  "Switch",
  "Mobile",
] as const;

const TOPIC_LABELS: Record<string, string> = {
  building: "Building",
  editing: "Editing",
  aim: "Aim",
  game_sense: "Game sense",
  mental: "Mental game",
  tournament_prep: "Tournament prep",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  unreal: "Unreal",
};

type FormState = {
  intake_id: string;
  kid_first_name: string;
  kid_age: string;
  kid_fortnite_username: string;
  kid_discord_username: string;
  kid_rank: string;
  kid_platform: string;
  kid_hours_per_week: string;
  parent_first_name: string;
  parent_email: string;
  what_to_help_with: string;
  selected_lesson_id: string | null;
};

type CoppaStatus =
  | { kind: "unneeded" }
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "pending" }
  | { kind: "verified" }
  | { kind: "error"; reason: string };

function freshIntakeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultState(): FormState {
  return {
    intake_id: freshIntakeId(),
    kid_first_name: "",
    kid_age: "",
    kid_fortnite_username: "",
    kid_discord_username: "",
    kid_rank: "",
    kid_platform: "",
    kid_hours_per_week: "",
    parent_first_name: "",
    parent_email: "",
    what_to_help_with: "",
    selected_lesson_id: null,
  };
}

function loadState(): FormState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormState>;
    return { ...defaultState(), ...parsed };
  } catch {
    return null;
  }
}

function persistState(s: FormState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export default function SingleSessionClient({
  catalog,
  verifiedIntakeId,
  coppaError,
}: {
  catalog: CatalogLesson[];
  verifiedIntakeId: string | null;
  coppaError: string | null;
}) {
  const [state, setState] = useState<FormState>(() => loadState() ?? defaultState());
  const [coppa, setCoppa] = useState<CoppaStatus>({ kind: "unneeded" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasHydrated = useRef(false);
  useEffect(() => {
    // First mount: pull persisted state.
    if (!hasHydrated.current) {
      const loaded = loadState();
      if (loaded) setState(loaded);
      hasHydrated.current = true;
    }
  }, []);

  useEffect(() => {
    persistState(state);
  }, [state]);

  // If the parent returned from clicking the verification link
  // (verifiedIntakeId in URL matches our local intake_id), mark
  // the COPPA gate as verified.
  useEffect(() => {
    if (verifiedIntakeId && verifiedIntakeId === state.intake_id) {
      setCoppa({ kind: "verified" });
    } else if (coppaError) {
      setCoppa({ kind: "error", reason: coppaError });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedIntakeId, coppaError]);

  const ageNum = useMemo(() => {
    const n = Number(state.kid_age);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [state.kid_age]);

  const needsCoppa = ageNum !== null && ageNum < 13;

  // Auto-reset COPPA state when age moves in/out of the under-13 zone.
  useEffect(() => {
    if (!needsCoppa && coppa.kind !== "unneeded") {
      setCoppa({ kind: "unneeded" });
    } else if (needsCoppa && coppa.kind === "unneeded") {
      setCoppa({ kind: "idle" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCoppa]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!state.kid_first_name.trim()) return false;
    if (ageNum === null || ageNum < 8 || ageNum > 18) return false;
    if (!state.kid_fortnite_username.trim()) return false;
    if (!state.kid_discord_username.trim()) return false;
    if (!state.kid_rank) return false;
    if (!state.kid_platform) return false;
    if (!state.kid_hours_per_week.trim()) return false;
    if (!state.parent_first_name.trim()) return false;
    if (!state.parent_email.trim()) return false;
    if (!/^\S+@\S+\.\S+$/.test(state.parent_email)) return false;
    if (!state.what_to_help_with.trim()) return false;
    if (!state.selected_lesson_id) return false;
    if (needsCoppa && coppa.kind !== "verified") return false;
    return true;
  }, [state, ageNum, needsCoppa, coppa, submitting]);

  async function requestCoppaVerification() {
    if (
      !state.parent_email.trim() ||
      !state.parent_first_name.trim() ||
      !/^\S+@\S+\.\S+$/.test(state.parent_email)
    ) {
      setCoppa({ kind: "error", reason: "missing_parent" });
      return;
    }
    setCoppa({ kind: "requesting" });
    try {
      const res = await fetch("/api/intake/request-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intake_id: state.intake_id,
          parent_first_name: state.parent_first_name.trim(),
          parent_email: state.parent_email.trim(),
          kid_first_name: state.kid_first_name.trim(),
          // Pass the single-session path so the verification email's
          // return link sends them back here, not /intake.
          return_to: "/single-session",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setCoppa({ kind: "error", reason: body.error ?? "send_failed" });
        return;
      }
      setCoppa({ kind: "pending" });
    } catch {
      setCoppa({ kind: "error", reason: "network" });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/single-session/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intake_id: state.intake_id,
          kid_first_name: state.kid_first_name.trim(),
          kid_age: ageNum,
          kid_fortnite_username: state.kid_fortnite_username.trim(),
          kid_discord_username: state.kid_discord_username.trim(),
          kid_rank: state.kid_rank,
          kid_platform: state.kid_platform,
          kid_hours_per_week: Number(state.kid_hours_per_week) || 0,
          parent_first_name: state.parent_first_name.trim(),
          parent_email: state.parent_email.trim(),
          what_to_help_with: state.what_to_help_with.trim(),
          lesson_id: state.selected_lesson_id,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
      };
      if (!res.ok || !body.url) {
        setSubmitError(body.error ?? "submit_failed");
        setSubmitting(false);
        return;
      }
      // Wipe local state — Stripe Checkout takes it from here.
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORAGE_KEY);
        window.location.href = body.url;
      }
    } catch {
      setSubmitError("network");
      setSubmitting(false);
    }
  }

  const selectedLesson =
    catalog.find((l) => l.id === state.selected_lesson_id) ?? null;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.eyebrow}>Single coaching session</div>
        <h1 className={styles.title}>One session with Tim. $24.</h1>
        <p className={styles.subtitle}>
          A 30 minute coaching call on Discord plus the lesson materials.
          Pick the lesson that matters most. No subscription.
        </p>
      </header>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {/* ---- Section 1: kid info ---- */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>About the player</h2>

          <label className={styles.field}>
            <span>First name</span>
            <input
              type="text"
              value={state.kid_first_name}
              onChange={(e) => setField("kid_first_name", e.target.value)}
              maxLength={60}
              autoComplete="off"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Age</span>
            <input
              type="number"
              value={state.kid_age}
              onChange={(e) => setField("kid_age", e.target.value)}
              min={8}
              max={18}
              required
            />
            {ageNum !== null && (ageNum < 8 || ageNum > 18) ? (
              <span className={styles.fieldError}>
                Tim coaches ages 8 to 18. Email tim@xplkeyed.com if you
                think it should be a fit.
              </span>
            ) : null}
          </label>

          <label className={styles.field}>
            <span>Fortnite username (IGN)</span>
            <input
              type="text"
              value={state.kid_fortnite_username}
              onChange={(e) => setField("kid_fortnite_username", e.target.value)}
              maxLength={32}
              autoComplete="off"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Discord username</span>
            <input
              type="text"
              value={state.kid_discord_username}
              onChange={(e) => setField("kid_discord_username", e.target.value)}
              maxLength={32}
              autoComplete="off"
              required
            />
            <span className={styles.fieldHint}>
              The call happens on Discord. Tim sends a server invite to this
              username before the session.
            </span>
          </label>

          <label className={styles.field}>
            <span>Current rank</span>
            <select
              value={state.kid_rank}
              onChange={(e) => setField("kid_rank", e.target.value)}
              required
            >
              <option value="">Pick one</option>
              {RANK_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Platform</span>
            <select
              value={state.kid_platform}
              onChange={(e) => setField("kid_platform", e.target.value)}
              required
            >
              <option value="">Pick one</option>
              {PLATFORM_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Hours per week playing</span>
            <input
              type="number"
              value={state.kid_hours_per_week}
              onChange={(e) => setField("kid_hours_per_week", e.target.value)}
              min={0}
              max={168}
              required
            />
            <span className={styles.fieldHint}>
              Rough estimate is fine.
            </span>
          </label>
        </section>

        {/* ---- Section 2: parent info + COPPA gate ---- */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Parent contact</h2>

          <label className={styles.field}>
            <span>Your first name</span>
            <input
              type="text"
              value={state.parent_first_name}
              onChange={(e) => setField("parent_first_name", e.target.value)}
              maxLength={60}
              autoComplete="given-name"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Your email</span>
            <input
              type="email"
              value={state.parent_email}
              onChange={(e) => setField("parent_email", e.target.value)}
              autoComplete="email"
              required
            />
            <span className={styles.fieldHint}>
              The Stripe receipt, the calendar link, and the session
              materials all go here.
            </span>
          </label>

          {needsCoppa ? (
            <div className={styles.coppaGate}>
              <div className={styles.coppaEyebrow}>Parent verification</div>
              <p className={styles.coppaBody}>
                Because {state.kid_first_name || "your kid"} is under 13, we
                need a quick email confirmation that you&apos;re the parent
                before we can record anything else.
              </p>

              {coppa.kind === "idle" || coppa.kind === "error" ? (
                <>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={requestCoppaVerification}
                  >
                    Send me the verification email
                  </button>
                  {coppa.kind === "error" ? (
                    <p className={styles.coppaError}>
                      Couldn&apos;t send the verification email
                      {coppa.reason === "missing_parent"
                        ? " — fill in your name and email above first."
                        : ". Try again in a moment."}
                    </p>
                  ) : null}
                </>
              ) : null}

              {coppa.kind === "requesting" ? (
                <p className={styles.coppaPending}>Sending verification email...</p>
              ) : null}

              {coppa.kind === "pending" ? (
                <p className={styles.coppaPending}>
                  Check your inbox. Click the link, you&apos;ll come back
                  here with the gate cleared.
                </p>
              ) : null}

              {coppa.kind === "verified" ? (
                <p className={styles.coppaVerified}>
                  Verified. Continue below.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* ---- Section 3: what they want help with ---- */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>What do they want help with?</h2>
          <p className={styles.cardBody}>
            One or two sentences. Tim reads this before the call so he can
            come ready to talk about exactly that.
          </p>
          <label className={styles.field}>
            <textarea
              value={state.what_to_help_with}
              onChange={(e) => setField("what_to_help_with", e.target.value)}
              maxLength={1000}
              rows={4}
              required
              placeholder={
                "Example: He gets third partied a lot when he wins fights and wants to learn how to rotate faster."
              }
            />
          </label>
        </section>

        {/* ---- Section 4: lesson picker ---- */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Pick the lesson</h2>
          <p className={styles.cardBody}>
            Each lesson is a focused 30 minute session. Materials drop to the
            player view after the call so they can review.
          </p>

          {catalog.length === 0 ? (
            <p className={styles.emptyCatalog}>
              Tim&apos;s lesson catalog is still coming online. Email{" "}
              <a href="mailto:tim@xplkeyed.com">tim@xplkeyed.com</a> and
              he&apos;ll set you up directly.
            </p>
          ) : (
            <ul className={styles.lessonList}>
              {catalog.map((lesson) => {
                const active = state.selected_lesson_id === lesson.id;
                return (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      className={`${styles.lessonRow} ${
                        active ? styles.lessonRowActive : ""
                      }`}
                      onClick={() => setField("selected_lesson_id", lesson.id)}
                    >
                      <span className={styles.lessonHeading}>
                        {lesson.parent_label}
                      </span>
                      <span className={styles.lessonSub}>
                        {lesson.parent_skill_description}
                      </span>
                      <span className={styles.lessonMeta}>
                        {TOPIC_LABELS[lesson.topic] ?? lesson.topic}
                        {" · "}
                        {DIFFICULTY_LABELS[lesson.difficulty_level] ??
                          lesson.difficulty_level}
                        {lesson.duration_minutes
                          ? ` · ${lesson.duration_minutes} min`
                          : null}
                      </span>
                      <span className={styles.lessonFortnite}>
                        Fortnite term: {lesson.fortnite_label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---- Submit ---- */}
        <div className={styles.submitRow}>
          {selectedLesson ? (
            <p className={styles.summary}>
              You&apos;re booking{" "}
              <strong>{selectedLesson.parent_label}</strong> for{" "}
              {state.kid_first_name || "the player"}. $24, charged once.
            </p>
          ) : null}

          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={!canSubmit}
          >
            {submitting ? "Opening Stripe Checkout..." : "Continue to payment"}
          </button>

          {submitError ? (
            <p className={styles.submitError}>
              Something went wrong (
              <code>{submitError}</code>). Try again, or email{" "}
              <a href="mailto:tim@xplkeyed.com">tim@xplkeyed.com</a> if it
              keeps failing.
            </p>
          ) : null}
        </div>
      </form>
    </main>
  );
}
