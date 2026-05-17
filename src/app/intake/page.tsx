"use client";

// Stage A intake form. Mobile-first, gamified, 4-level state machine.
// Tokens (colors, fonts, breakpoints) inherited from globals.css :root.
// Hard rule #8: every user-facing string here must be free of em/en/hyphen
// dashes. Use periods, commas, "to", "and", or closed compounds instead.
//
// Step 4a + 4b: scaffold + Level 1 + inline under-13 COPPA gate.
// Levels 2-4 are placeholders for the next steps.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Script from "next/script";
import styles from "./page.module.css";

const CALENDLY_EVENT_URL = "https://calendly.com/xpl-keyed/intro-call";
// NOTE: Calendly custom-question IDs are assumed to be a1..a5 in the order
// set up at https://calendly.com/event_types/.../edit:
//   a1 = kid's first name
//   a2 = kid's Discord username
//   a3 = kid's Fortnite IGN
//   a4 = kid's age
//   a5 = (optional) what they want to get better at
// If any of these drift out of order, prefill silently lands in the wrong
// field. Verify by booking a test call after Step 4d ships and confirm the
// 5 custom answers map correctly.

const STORAGE_KEY = "xpl-intake-v1";
const LEVEL_META = [
  { key: 1, title: "Player Profile", color: "var(--uncommon)", kicker: "Tell us who's playing." },
  { key: 2, title: "Skill Check",    color: "var(--rare)",     kicker: "Where you're at right now." },
  { key: 3, title: "Parent Contact", color: "var(--epic)",     kicker: "So we can include your parent." },
  { key: 4, title: "Schedule Call",  color: "var(--legendary)",kicker: "Lock in your free intro call." },
] as const;
const TOTAL_LEVELS = LEVEL_META.length;

// Fortnite competitive ranks, low to high. "Not ranked yet" first so brand-new
// kids don't feel they have to claim a tier. Tim only needs the band, not the
// sub-tier (I/II/III).
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

type CoppaState =
  | { kind: "unneeded" }
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "pending"; sentTo: string }
  | { kind: "verified" }
  | { kind: "error"; reason: "expired" | "not_found" | "server" | "send_failed" };

interface FormState {
  intake_id: string;
  // L1
  kid_first_name: string;
  kid_age: string;                // string in state to keep input controlled; coerced at submit
  kid_fortnite_username: string;
  kid_discord_username: string;
  // L2
  kid_current_rank: string;
  kid_platform: string;
  kid_hours_per_week: string;     // string in state; coerced at submit
  // L3 / under-13 gate
  parent_first_name: string;
  parent_email: string;
  // Coppa state is derived from age + verification; not persisted as a flag.
}

function freshIntakeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for older browsers; should never hit in our target set.
  return "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}

function loadState(): FormState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormState>;
    if (!parsed.intake_id) return null;
    return {
      intake_id: parsed.intake_id,
      kid_first_name: parsed.kid_first_name ?? "",
      kid_age: parsed.kid_age ?? "",
      kid_fortnite_username: parsed.kid_fortnite_username ?? "",
      kid_discord_username: parsed.kid_discord_username ?? "",
      kid_current_rank: parsed.kid_current_rank ?? "",
      kid_platform: parsed.kid_platform ?? "",
      kid_hours_per_week: parsed.kid_hours_per_week ?? "",
      parent_first_name: parsed.parent_first_name ?? "",
      parent_email: parsed.parent_email ?? "",
    };
  } catch {
    return null;
  }
}

function persistState(state: FormState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private mode. Form still works in-memory.
  }
}

export default function IntakePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [level, setLevel] = useState<number>(1);
  const [state, setState] = useState<FormState>(() => ({
    intake_id: freshIntakeId(),
    kid_first_name: "",
    kid_age: "",
    kid_fortnite_username: "",
    kid_discord_username: "",
    kid_current_rank: "",
    kid_platform: "",
    kid_hours_per_week: "",
    parent_first_name: "",
    parent_email: "",
  }));
  const [coppa, setCoppa] = useState<CoppaState>({ kind: "unneeded" });
  const [hydrated, setHydrated] = useState(false);

  // Page-level lifecycle after the user reaches Level 4:
  //   form         -> normal multi-level form
  //   submitting   -> Calendly returned success, /api/intake/submit in flight
  //   success      -> account created, magic link emailed; final card visible
  //   submit_failed-> Calendly event exists, our backend failed; retry path
  const [stage, setStage] = useState<"form" | "submitting" | "success" | "submit_failed">("form");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---- Hydrate from localStorage + URL params on mount -------------------
  useEffect(() => {
    const restored = loadState();
    if (restored) setState(restored);
    setHydrated(true);
  }, []);

  // ---- Handle ?verified=<id> and ?coppa_error=... ------------------------
  useEffect(() => {
    if (!hydrated) return;
    const verified = searchParams.get("verified");
    const errParam = searchParams.get("coppa_error");
    if (verified && verified === state.intake_id) {
      setCoppa({ kind: "verified" });
      // Strip the URL params so a refresh doesn't re-trigger anything.
      router.replace("/intake");
      return;
    }
    if (errParam === "expired" || errParam === "not_found" || errParam === "server") {
      setCoppa({ kind: "error", reason: errParam });
      router.replace("/intake");
    }
  }, [hydrated, searchParams, state.intake_id, router]);

  // ---- Persist on every state change after hydration ---------------------
  useEffect(() => {
    if (hydrated) persistState(state);
  }, [state, hydrated]);

  const ageNum = useMemo(() => {
    const n = parseInt(state.kid_age, 10);
    return Number.isFinite(n) ? n : null;
  }, [state.kid_age]);

  const needsCoppa = ageNum !== null && ageNum >= 8 && ageNum < 13;

  // Reset coppa state if user changes age into / out of the under-13 zone.
  useEffect(() => {
    if (!needsCoppa && coppa.kind !== "unneeded") setCoppa({ kind: "unneeded" });
    if (needsCoppa && coppa.kind === "unneeded") setCoppa({ kind: "idle" });
  }, [needsCoppa, coppa.kind]);

  const setField = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setState((prev) => ({ ...prev, [key]: val }));
  }, []);

  // ---- Validation --------------------------------------------------------
  const l1FieldsValid =
    state.kid_first_name.trim().length > 0 &&
    ageNum !== null && ageNum >= 8 && ageNum <= 18 &&
    state.kid_fortnite_username.trim().length > 0 &&
    state.kid_discord_username.trim().length > 0;

  const hoursNum = useMemo(() => {
    const n = parseInt(state.kid_hours_per_week, 10);
    return Number.isFinite(n) ? n : null;
  }, [state.kid_hours_per_week]);

  const l2FieldsValid =
    RANK_OPTIONS.includes(state.kid_current_rank as (typeof RANK_OPTIONS)[number]) &&
    PLATFORM_OPTIONS.includes(state.kid_platform as (typeof PLATFORM_OPTIONS)[number]) &&
    hoursNum !== null && hoursNum >= 0 && hoursNum <= 168;

  const parentFieldsValid =
    state.parent_first_name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.parent_email.trim());

  // L3 for under-13 reuses the gate's parent fields (already verified, locked).
  // For 13+, the user enters them at L3 fresh.
  const l3FieldsValid = parentFieldsValid;

  const canSendVerification = needsCoppa && parentFieldsValid &&
    (coppa.kind === "idle" || coppa.kind === "error");

  const canAdvanceFromL1 =
    l1FieldsValid && (!needsCoppa || coppa.kind === "verified");

  const canAdvance =
    (level === 1 && canAdvanceFromL1) ||
    (level === 2 && l2FieldsValid) ||
    (level === 3 && l3FieldsValid);

  // ---- Final intake submit (fires after Calendly success) ----------------
  const submitIntake = useCallback(async () => {
    setStage("submitting");
    setSubmitError(null);
    try {
      const res = await fetch("/api/intake/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intake_id: state.intake_id,
          parent_first_name: state.parent_first_name.trim(),
          parent_email: state.parent_email.trim(),
          kid_first_name: state.kid_first_name.trim(),
          kid_age: parseInt(state.kid_age, 10),
          kid_fortnite_username: state.kid_fortnite_username.trim(),
          kid_discord_username: state.kid_discord_username.trim(),
          kid_current_rank: state.kid_current_rank,
          kid_platform: state.kid_platform,
          kid_hours_per_week: parseInt(state.kid_hours_per_week, 10),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setSubmitError(body.error ?? `http_${res.status}`);
        setStage("submit_failed");
        return;
      }
      // Clear local form state so a refresh on success doesn't show stale data.
      if (typeof window !== "undefined") {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* quota */ }
      }
      setStage("success");
    } catch {
      setSubmitError("network");
      setStage("submit_failed");
    }
  }, [state]);

  // ---- Listen for Calendly's calendly.event_scheduled postMessage --------
  useEffect(() => {
    if (level !== TOTAL_LEVELS) return;
    if (stage !== "form") return;
    function isCalendlyEvent(e: MessageEvent): boolean {
      return typeof e.data === "object"
        && e.data !== null
        && typeof (e.data as { event?: unknown }).event === "string"
        && (e.data as { event: string }).event.startsWith("calendly.");
    }
    const handler = (e: MessageEvent) => {
      if (!isCalendlyEvent(e)) return;
      const eventName = (e.data as { event: string }).event;
      if (eventName === "calendly.event_scheduled") {
        // Fire and forget; submitIntake manages its own stage transitions.
        void submitIntake();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [level, stage, submitIntake]);

  // ---- Request COPPA verification ----------------------------------------
  const requestVerification = useCallback(async () => {
    if (!canSendVerification) return;
    setCoppa({ kind: "requesting" });
    try {
      const res = await fetch("/api/intake/request-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intake_id: state.intake_id,
          parent_first_name: state.parent_first_name.trim(),
          parent_email: state.parent_email.trim(),
        }),
      });
      if (!res.ok) throw new Error("send_failed");
      setCoppa({ kind: "pending", sentTo: state.parent_email.trim() });
    } catch {
      setCoppa({ kind: "error", reason: "send_failed" });
    }
  }, [canSendVerification, state.intake_id, state.parent_first_name, state.parent_email]);

  // ---- Level progress / XP bar -------------------------------------------
  const meta = LEVEL_META[level - 1];
  // XP fills in proportion to completed levels (each level worth 25%).
  // Within the current level, a soft nudge to 80% of the segment fires when
  // the user has satisfied the level's gating logic, so the bar feels alive
  // before they tap Next.
  const segmentSize = 100 / TOTAL_LEVELS;
  const baseFill = (level - 1) * segmentSize;
  const withinLevelNudge = canAdvance ? segmentSize * 0.8 : 0;
  const xpPct = Math.min(100, baseFill + withinLevelNudge);

  // After Calendly success, XP bar reads 100%; success card replaces form.
  const displayedXp = stage === "success" ? 100 : xpPct;
  const displayedLevelColor = stage === "success" ? "var(--lime)" : meta.color;
  const displayedLevelLabel = stage === "success" ? "DASHBOARD UNLOCKED" : `LEVEL ${level}: ${meta.title.toUpperCase()}`;

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <div className={styles.brand}>XPL KEYED</div>

        <div className={styles.progress}>
          <span className={styles.progressLabel} style={{ color: displayedLevelColor }}>
            {displayedLevelLabel}
          </span>
          <span className={styles.progressCount}>
            {stage === "success" ? "DONE" : `${level} OF ${TOTAL_LEVELS}`}
          </span>
        </div>
        <div className={styles.xpTrack} aria-hidden="true">
          <div className={styles.xpFill} style={{ width: `${displayedXp}%`, background: displayedLevelColor }} />
        </div>

        <div className={styles.card}>
          {stage === "form" && (
            <>
              <h1 className={styles.levelTitle} style={{ color: meta.color }}>{meta.title}</h1>
              <p className={styles.levelKicker}>{meta.kicker}</p>

              {level === 1 && (
                <Level1
                  state={state}
                  setField={setField}
                  ageNum={ageNum}
                  needsCoppa={needsCoppa}
                  coppa={coppa}
                  canSendVerification={canSendVerification}
                  requestVerification={requestVerification}
                />
              )}

              {level === 2 && <Level2 state={state} setField={setField} />}

              {level === 3 && <Level3
                state={state}
                setField={setField}
                lockedByCoppa={needsCoppa && coppa.kind === "verified"}
              />}

              {level === 4 && <Level4 state={state} />}

              <div className={styles.actions}>
                {level > 1 && (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={() => setLevel((l) => Math.max(1, l - 1))}
                  >
                    Back
                  </button>
                )}
                {level < TOTAL_LEVELS && (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={!canAdvance}
                    onClick={() => setLevel((l) => Math.min(TOTAL_LEVELS, l + 1))}
                    aria-disabled={!canAdvance}
                  >
                    Next
                  </button>
                )}
              </div>
            </>
          )}

          {stage === "submitting" && <SubmittingCard />}

          {stage === "success" && <SuccessCard
            kidFirstName={state.kid_first_name}
            parentEmail={state.parent_email}
          />}

          {stage === "submit_failed" && <FailureCard
            error={submitError}
            onRetry={submitIntake}
          />}
        </div>

        {stage === "form" && (
          <p className={styles.helperRow}>
            Your progress is saved on this device. Come back any time on this browser.
          </p>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Level 1: Player Profile (+ inline under-13 COPPA gate)
// ---------------------------------------------------------------------------

interface Level1Props {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  ageNum: number | null;
  needsCoppa: boolean;
  coppa: CoppaState;
  canSendVerification: boolean;
  requestVerification: () => void;
}

function Level1({ state, setField, ageNum, needsCoppa, coppa, canSendVerification, requestVerification }: Level1Props) {
  const ageOutOfRange = state.kid_age !== "" && (ageNum === null || ageNum < 8 || ageNum > 18);
  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>What's your first name?</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="given-name"
          maxLength={80}
          value={state.kid_first_name}
          onChange={(e) => setField("kid_first_name", e.target.value)}
          placeholder="Jake"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>How old are you?</span>
        <input
          className={styles.fieldInput}
          type="number"
          inputMode="numeric"
          min={8}
          max={18}
          value={state.kid_age}
          onChange={(e) => setField("kid_age", e.target.value)}
          placeholder="14"
        />
        {ageOutOfRange && (
          <span className={styles.fieldError}>
            Coaching is for ages 8 to 18. Reach out at tim@xplkeyed.com if you're outside that range.
          </span>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Fortnite username</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="off"
          maxLength={80}
          value={state.kid_fortnite_username}
          onChange={(e) => setField("kid_fortnite_username", e.target.value)}
          placeholder="JakeFN"
        />
        <span className={styles.fieldHint}>The name shown in your game profile.</span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Discord username</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="off"
          maxLength={80}
          value={state.kid_discord_username}
          onChange={(e) => setField("kid_discord_username", e.target.value)}
          placeholder="jakedc"
        />
        <span className={styles.fieldHint}>Coaching happens on Discord. Tim sends the server invite to this username.</span>
      </label>

      {needsCoppa && <CoppaGate
        state={state}
        setField={setField}
        coppa={coppa}
        canSendVerification={canSendVerification}
        requestVerification={requestVerification}
      />}
    </>
  );
}

// ---------------------------------------------------------------------------
// COPPA gate (rendered inline at the bottom of Level 1 when age <13)
// ---------------------------------------------------------------------------

interface CoppaGateProps {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  coppa: CoppaState;
  canSendVerification: boolean;
  requestVerification: () => void;
}

function CoppaGate({ state, setField, coppa, canSendVerification, requestVerification }: CoppaGateProps) {
  return (
    <div className={styles.gate}>
      <div className={styles.gateHeading}>One step for your parent</div>
      <p className={styles.gateBody}>
        Because you're under 13, your parent has to approve before we go any further. Type their name and email, tap the button, and we'll send them a one tap link.
      </p>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Parent's first name</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="off"
          maxLength={80}
          value={state.parent_first_name}
          onChange={(e) => setField("parent_first_name", e.target.value)}
          placeholder="Sarah"
          disabled={coppa.kind === "requesting" || coppa.kind === "pending" || coppa.kind === "verified"}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Parent's email</span>
        <input
          className={styles.fieldInput}
          type="email"
          autoComplete="email"
          maxLength={254}
          value={state.parent_email}
          onChange={(e) => setField("parent_email", e.target.value)}
          placeholder="parent@example.com"
          disabled={coppa.kind === "requesting" || coppa.kind === "pending" || coppa.kind === "verified"}
        />
      </label>

      {coppa.kind !== "verified" && (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={!canSendVerification}
          onClick={requestVerification}
          style={{ width: "100%", flex: "none" }}
        >
          {coppa.kind === "requesting"
            ? "Sending..."
            : coppa.kind === "pending" || coppa.kind === "error"
              ? "Send a fresh approval email"
              : "Send approval email"}
        </button>
      )}

      {coppa.kind === "pending" && (
        <div className={styles.gateStatus}>
          We sent an email to <b>{coppa.sentTo}</b>. Your parent should tap the button inside. Open the link on this same browser so your progress stays saved.
        </div>
      )}

      {coppa.kind === "verified" && (
        <div className={`${styles.gateStatus} ${styles.gateStatusOk}`}>
          Approved by {state.parent_first_name || "your parent"}. You can move on to Level 2.
        </div>
      )}

      {coppa.kind === "error" && (
        <div className={`${styles.gateStatus} ${styles.gateStatusErr}`}>
          {coppa.reason === "expired" && "That link expired. Tap the button above to send a fresh one."}
          {coppa.reason === "not_found" && "We couldn't match that link. Tap the button to send a new one."}
          {coppa.reason === "server" && "Something went sideways on our end. Try again."}
          {coppa.reason === "send_failed" && "We couldn't send the email. Check the address and try again."}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 2: Skill Check (rank, platform, hours/week)
// ---------------------------------------------------------------------------

interface Level2Props {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
}

function Level2({ state, setField }: Level2Props) {
  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Current rank</span>
        <select
          className={styles.fieldSelect}
          value={state.kid_current_rank}
          onChange={(e) => setField("kid_current_rank", e.target.value)}
        >
          <option value="" disabled>Pick your rank...</option>
          {RANK_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <span className={styles.fieldHint}>Where you are in Ranked right now. Pick the band even if you're working through the sub tiers.</span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Platform</span>
        <select
          className={styles.fieldSelect}
          value={state.kid_platform}
          onChange={(e) => setField("kid_platform", e.target.value)}
        >
          <option value="" disabled>Pick your platform...</option>
          {PLATFORM_OPTIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Hours you play per week</span>
        <input
          className={styles.fieldInput}
          type="number"
          inputMode="numeric"
          min={0}
          max={168}
          value={state.kid_hours_per_week}
          onChange={(e) => setField("kid_hours_per_week", e.target.value)}
          placeholder="10"
        />
        <span className={styles.fieldHint}>Rough estimate is fine. Helps Tim size the curriculum.</span>
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Level 3: Parent Contact
// For 13+, parent enters fresh fields.
// For under-13, the L1 gate already collected and verified these. We render a
// read only card with a "go back to Level 1 to change" hint, so the parent
// can't accidentally invalidate the verified email mid flow.
// ---------------------------------------------------------------------------

interface Level3Props {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  lockedByCoppa: boolean;
}

function Level3({ state, setField, lockedByCoppa }: Level3Props) {
  if (lockedByCoppa) {
    return (
      <div className={`${styles.gate}`} style={{ borderColor: "rgba(199, 255, 61, 0.4)" }}>
        <div className={styles.gateHeading} style={{ color: "var(--lime)" }}>Parent on file</div>
        <p className={styles.gateBody}>
          Your parent already approved at Level 1. We saved their info.
        </p>
        <div className={`${styles.gateStatus} ${styles.gateStatusOk}`}>
          <div><b>{state.parent_first_name}</b></div>
          <div style={{ marginTop: 4, color: "rgba(255,255,255,0.85)" }}>{state.parent_email}</div>
        </div>
        <p className={styles.fieldHint} style={{ marginTop: 12 }}>
          Need to change the email? Tap Back, then go back one more time to Level 1.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className={styles.levelKicker} style={{ marginTop: -12 }}>
        Your parent's name and email. They'll get a welcome email and a single sign on link to the dashboard.
      </p>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Parent's first name</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="off"
          maxLength={80}
          value={state.parent_first_name}
          onChange={(e) => setField("parent_first_name", e.target.value)}
          placeholder="Sarah"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Parent's email</span>
        <input
          className={styles.fieldInput}
          type="email"
          autoComplete="email"
          maxLength={254}
          value={state.parent_email}
          onChange={(e) => setField("parent_email", e.target.value)}
          placeholder="parent@example.com"
        />
        <span className={styles.fieldHint}>We send call reminders, post lesson notes, and your parent's dashboard link here.</span>
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Level 4: Calendly embed
// ---------------------------------------------------------------------------
// Calendly's widget.js loads via next/script and auto-initializes any
// <div class="calendly-inline-widget"> on the page using the data-url.
// We pass prefill via URL query params (Calendly supports both `name`/`email`
// at the top level and `a1`..`aN` for custom answers). Colors are themed to
// our palette so the embed feels native on the dark page.
//
// The booking success signal arrives via window.postMessage; the listener
// lives at the page level so the success card can replace the whole form.

function buildCalendlyUrl(state: FormState): string {
  const url = new URL(CALENDLY_EVENT_URL);
  url.searchParams.set("hide_gdpr_banner", "1");
  url.searchParams.set("hide_event_type_details", "1");
  url.searchParams.set("background_color", "0F1B47");
  url.searchParams.set("text_color", "FFFFFF");
  url.searchParams.set("primary_color", "C7FF3D");
  // Top-level Calendly fields (parent is the booker).
  if (state.parent_first_name) url.searchParams.set("name", state.parent_first_name);
  if (state.parent_email)      url.searchParams.set("email", state.parent_email);
  // Custom answers. See CALENDLY_EVENT_URL comment for the assumed order.
  if (state.kid_first_name)        url.searchParams.set("a1", state.kid_first_name);
  if (state.kid_discord_username)  url.searchParams.set("a2", state.kid_discord_username);
  if (state.kid_fortnite_username) url.searchParams.set("a3", state.kid_fortnite_username);
  if (state.kid_age)               url.searchParams.set("a4", state.kid_age);
  return url.toString();
}

interface Level4Props { state: FormState }

function Level4({ state }: Level4Props) {
  return (
    <>
      <p className={styles.calendlyHint}>
        Pick a time below that works for {state.kid_first_name || "your kid"}. The free intro call is 30 minutes on Discord. We send the server invite to {state.kid_discord_username || "the Discord username you provided"} after you book.
      </p>
      <div
        className={`calendly-inline-widget ${styles.calendlyEmbed}`}
        data-url={buildCalendlyUrl(state)}
      />
      <Script
        src="https://assets.calendly.com/assets/external/widget.js"
        strategy="afterInteractive"
      />
    </>
  );
}

function SubmittingCard() {
  return (
    <div className={styles.submittingCard}>
      <div className={styles.spinner} aria-hidden="true" />
      <h2 className={styles.unlockedHeadline} style={{ color: "var(--lime)" }}>Setting up your dashboard</h2>
      <p className={styles.successBody}>
        Hang tight. We're creating your account and emailing your parent the sign in link.
      </p>
    </div>
  );
}

interface SuccessCardProps { kidFirstName: string; parentEmail: string }

function SuccessCard({ kidFirstName, parentEmail }: SuccessCardProps) {
  return (
    <div className={styles.successCard}>
      <div className={styles.unlockedKicker}>ACHIEVEMENT UNLOCKED</div>
      <h2 className={styles.unlockedHeadline}>Free Trial Booked</h2>
      <p className={styles.successBody}>
        Nice work, {kidFirstName || "champ"}. We emailed your parent at <b>{parentEmail}</b> with a sign in link. They tap it, your dashboard opens, and your quest log goes live.
      </p>
      <p className={styles.successBody}>
        While you wait for the call, Tim wants to watch a clip. Look out for the Drop a VOD quest in your dashboard.
      </p>
      <span className={styles.successDetail}>
        You'll also get a Calendly email with the call time. Check spam if it's not in the inbox.
      </span>
    </div>
  );
}

interface FailureCardProps { error: string | null; onRetry: () => void }

function FailureCard({ error, onRetry }: FailureCardProps) {
  const friendly = error === "parent_email_already_registered"
    ? "An account already exists for that parent email. Head to the sign in page instead."
    : error === "coppa_verification_required"
      ? "Your parent's approval needs to refresh. Go back to Level 1 and send the approval email again."
      : "Something went sideways on our end. Your call is still on the calendar. Tap retry and we'll finish setting up your dashboard.";
  return (
    <div className={styles.failureCard}>
      <h2 className={styles.unlockedHeadline} style={{ color: "var(--epic)" }}>Hold on</h2>
      <p className={styles.successBody}>{friendly}</p>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        onClick={onRetry}
        style={{ width: "100%", flex: "none" }}
      >
        Retry
      </button>
    </div>
  );
}

