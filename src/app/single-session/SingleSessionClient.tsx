"use client";

// SingleSessionClient
// -------------------
// 4-level gamified form mirroring /intake (XP bar, rarity colors per
// level, +25 XP floats, sound toggle, level transitions). Reuses
// intake's CSS module for the framework so visuals match exactly;
// adds a slim local module for the pay-block at Level 4 and the
// locked-parent display at Level 3.
//
// Level 4 differs from intake's Calendly handoff: parent types "what
// they want help with" (Tim's primary input signal for picking the
// lesson), then taps Pay $24 → POST to /api/single-session/submit →
// redirect to Stripe Checkout. NO lesson picker — Tim picks (or
// builds) the lesson after the payment lands. Per design pivot
// 2026-05-23.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "../intake/page.module.css";
import pay from "./page.module.css";

const STORAGE_KEY = "xpl-single-session-v2";
const SOUND_STORAGE_KEY = "xpl-single-session-sound";

const LEVEL_META = [
  {
    key: 1,
    title: "Player Profile",
    color: "var(--uncommon)",
    kicker: "Tell us who's playing.",
  },
  {
    key: 2,
    title: "Skill Check",
    color: "var(--rare)",
    kicker: "Where you're at right now.",
  },
  {
    key: 3,
    title: "Parent Contact",
    color: "var(--epic)",
    kicker: "So we can include your parent.",
  },
  {
    key: 4,
    title: "What & Pay",
    color: "var(--legendary)",
    kicker: "One last note, then $24 to lock it in.",
  },
] as const;
const TOTAL_LEVELS = LEVEL_META.length;

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

type FormState = {
  intake_id: string;
  kid_first_name: string;
  kid_age: string;
  kid_fortnite_username: string;
  kid_discord_username: string;
  kid_current_rank: string;
  kid_platform: string;
  kid_hours_per_week: string;
  parent_first_name: string;
  parent_email: string;
  what_to_help_with: string;
};

type CoppaState =
  | { kind: "unneeded" }
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "pending"; sentTo: string }
  | { kind: "verified" }
  | { kind: "error"; reason: "expired" | "not_found" | "server" | "send_failed" };

const LEVEL_UP_NOTES = [523.25, 783.99];
const SUCCESS_NOTES = [523.25, 659.25, 783.99, 1046.5];

function playChime(
  notes: number[],
  ctxRef: { current: AudioContext | null },
) {
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  if (!ctxRef.current) ctxRef.current = new Ctx();
  const ctx = ctxRef.current;
  const now = ctx.currentTime;
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const start = now + i * 0.085;
    const dur = 0.14;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.start(start);
    osc.stop(start + dur);
  });
}

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
    kid_current_rank: "",
    kid_platform: "",
    kid_hours_per_week: "",
    parent_first_name: "",
    parent_email: "",
    what_to_help_with: "",
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

export default function SingleSessionClient() {
  return (
    <Suspense fallback={null}>
      <SingleSessionInner />
    </Suspense>
  );
}

function SingleSessionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [level, setLevel] = useState<number>(1);
  const [state, setState] = useState<FormState>(defaultState);
  const [coppa, setCoppa] = useState<CoppaState>({ kind: "unneeded" });
  const [hydrated, setHydrated] = useState(false);

  const [soundOn, setSoundOn] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [xpFloats, setXpFloats] = useState<{ id: number }[]>([]);
  const xpFloatIdRef = useRef(0);

  const [stage, setStage] = useState<"form" | "submitting" | "submit_failed">("form");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Hydrate.
  useEffect(() => {
    const restored = loadState();
    if (restored) setState(restored);
    try {
      const stored = window.localStorage.getItem(SOUND_STORAGE_KEY);
      if (stored === "on") setSoundOn(true);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SOUND_STORAGE_KEY, next ? "on" : "off");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const popXpFloat = useCallback(
    (success = false) => {
      const id = ++xpFloatIdRef.current;
      setXpFloats((prev) => [...prev, { id }]);
      window.setTimeout(
        () => setXpFloats((prev) => prev.filter((f) => f.id !== id)),
        1500,
      );
      if (soundOn) playChime(success ? SUCCESS_NOTES : LEVEL_UP_NOTES, audioCtxRef);
    },
    [soundOn],
  );

  const prevLevelRef = useRef(level);
  useEffect(() => {
    if (!hydrated) {
      prevLevelRef.current = level;
      return;
    }
    if (level > prevLevelRef.current) popXpFloat(false);
    prevLevelRef.current = level;
  }, [level, hydrated, popXpFloat]);

  // ?verified= and ?coppa_error= round trip handling.
  useEffect(() => {
    if (!hydrated) return;
    const verified = searchParams.get("verified");
    const errParam = searchParams.get("coppa_error");
    if (verified && verified === state.intake_id) {
      setCoppa({ kind: "verified" });
      (router.replace as (u: string) => void)("/single-session");
      return;
    }
    if (
      errParam === "expired" ||
      errParam === "not_found" ||
      errParam === "server"
    ) {
      setCoppa({ kind: "error", reason: errParam });
      (router.replace as (u: string) => void)("/single-session");
    }
  }, [hydrated, searchParams, state.intake_id, router]);

  useEffect(() => {
    if (hydrated) persistState(state);
  }, [state, hydrated]);

  const ageNum = useMemo(() => {
    const n = parseInt(state.kid_age, 10);
    return Number.isFinite(n) ? n : null;
  }, [state.kid_age]);

  const needsCoppa = ageNum !== null && ageNum >= 8 && ageNum < 13;

  useEffect(() => {
    if (!needsCoppa && coppa.kind !== "unneeded") setCoppa({ kind: "unneeded" });
    if (needsCoppa && coppa.kind === "unneeded") setCoppa({ kind: "idle" });
  }, [needsCoppa, coppa.kind]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, val: FormState[K]) => {
      setState((prev) => ({ ...prev, [key]: val }));
    },
    [],
  );

  // ---- Validation ---------------------------------------------------------

  const l1FieldsValid =
    state.kid_first_name.trim().length > 0 &&
    ageNum !== null &&
    ageNum >= 8 &&
    ageNum <= 18 &&
    state.kid_fortnite_username.trim().length > 0 &&
    state.kid_discord_username.trim().length > 0;

  const hoursNum = useMemo(() => {
    const n = parseInt(state.kid_hours_per_week, 10);
    return Number.isFinite(n) ? n : null;
  }, [state.kid_hours_per_week]);

  const l2FieldsValid =
    RANK_OPTIONS.includes(state.kid_current_rank as (typeof RANK_OPTIONS)[number]) &&
    PLATFORM_OPTIONS.includes(state.kid_platform as (typeof PLATFORM_OPTIONS)[number]) &&
    hoursNum !== null &&
    hoursNum >= 0 &&
    hoursNum <= 168;

  const parentFieldsValid =
    state.parent_first_name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.parent_email.trim());

  const l3FieldsValid = parentFieldsValid;

  const canSendVerification =
    needsCoppa &&
    parentFieldsValid &&
    (coppa.kind === "idle" || coppa.kind === "error");

  const canAdvanceFromL1 =
    l1FieldsValid && (!needsCoppa || coppa.kind === "verified");

  const canAdvance =
    (level === 1 && canAdvanceFromL1) ||
    (level === 2 && l2FieldsValid) ||
    (level === 3 && l3FieldsValid);

  const l4Valid = state.what_to_help_with.trim().length > 0;
  const canSubmit =
    stage === "form" &&
    l1FieldsValid &&
    l2FieldsValid &&
    l3FieldsValid &&
    l4Valid;

  // ---- COPPA verification request -----------------------------------------
  const requestVerification = useCallback(async () => {
    if (!canSendVerification) return;
    setCoppa({ kind: "requesting" });
    try {
      const res = await fetch("/api/intake/request-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intake_id: state.intake_id,
          parent_first_name: state.parent_first_name.trim(),
          parent_email: state.parent_email.trim(),
          return_to: "/single-session",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const reason =
          body.error === "email_send_failed"
            ? "send_failed"
            : ("server" as const);
        setCoppa({ kind: "error", reason });
        return;
      }
      setCoppa({ kind: "pending", sentTo: state.parent_email.trim() });
    } catch {
      setCoppa({ kind: "error", reason: "server" });
    }
  }, [
    canSendVerification,
    state.intake_id,
    state.parent_first_name,
    state.parent_email,
  ]);

  // ---- Submit (Pay) -------------------------------------------------------
  const submitOrder = useCallback(async () => {
    if (!canSubmit) return;
    setStage("submitting");
    setSubmitError(null);
    if (soundOn) playChime(SUCCESS_NOTES, audioCtxRef);
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
          kid_rank: state.kid_current_rank,
          kid_platform: state.kid_platform,
          kid_hours_per_week: hoursNum ?? 0,
          parent_first_name: state.parent_first_name.trim(),
          parent_email: state.parent_email.trim(),
          what_to_help_with: state.what_to_help_with.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
      };
      if (!res.ok || !body.url) {
        setSubmitError(body.error ?? "submit_failed");
        setStage("submit_failed");
        return;
      }
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      window.location.href = body.url;
    } catch {
      setSubmitError("network");
      setStage("submit_failed");
    }
  }, [canSubmit, soundOn, state, ageNum, hoursNum]);

  const meta = LEVEL_META[level - 1];
  const segmentSize = 100 / TOTAL_LEVELS;
  const baseProgress = (level - 1) * segmentSize;
  const withinLevelNudge =
    canAdvance || (level === 4 && l4Valid) ? segmentSize * 0.8 : 0;
  const progress = Math.min(100, baseProgress + withinLevelNudge);

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <div className={styles.topRow}>
          <button
            className={`${styles.soundToggle} ${styles.topRowSpacer}`}
            tabIndex={-1}
            aria-hidden="true"
          >
            SOUND OFF
          </button>
          <div className={styles.brand}>XPL KEYED</div>
          <button
            type="button"
            className={styles.soundToggle}
            data-on={soundOn ? "true" : "false"}
            onClick={toggleSound}
            aria-pressed={soundOn}
          >
            {soundOn ? "SOUND ON" : "SOUND OFF"}
          </button>
        </div>

        <div className={styles.progress}>
          <span className={styles.progressLabel} style={{ color: meta.color }}>
            {meta.title.toUpperCase()}
          </span>
          <span className={styles.progressCount}>
            {level} OF {TOTAL_LEVELS}
          </span>
        </div>
        <div className={styles.xpTrackWrap}>
          <div className={styles.xpTrack} aria-hidden="true">
            <div
              className={styles.xpFill}
              style={{ width: `${progress}%`, background: meta.color }}
            />
          </div>
          {xpFloats.map((f) => (
            <span key={f.id} className={styles.xpFloat} aria-hidden="true">
              +25 XP
            </span>
          ))}
        </div>

        <div className={styles.card}>
          <h1 className={styles.levelTitle} style={{ color: meta.color }}>
            {meta.title}
          </h1>
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

          {level === 3 && (
            <Level3
              state={state}
              setField={setField}
              lockedByCoppa={needsCoppa && coppa.kind === "verified"}
            />
          )}

          {level === 4 && (
            <Level4
              state={state}
              setField={setField}
              onSubmit={submitOrder}
              submitting={stage === "submitting"}
              canSubmit={canSubmit}
              submitError={stage === "submit_failed" ? submitError : null}
            />
          )}

          <div className={styles.actions}>
            {level > 1 && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => setLevel((l) => Math.max(1, l - 1))}
                disabled={stage === "submitting"}
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
            {/* Level 4 has its own Pay $24 button inside the level body. */}
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Level 1 — Player Profile
// ---------------------------------------------------------------------------

type Level1Props = {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  ageNum: number | null;
  needsCoppa: boolean;
  coppa: CoppaState;
  canSendVerification: boolean;
  requestVerification: () => void;
};

function Level1({
  state,
  setField,
  ageNum,
  needsCoppa,
  coppa,
  canSendVerification,
  requestVerification,
}: Level1Props) {
  const ageOutOfRange =
    state.kid_age !== "" && (ageNum === null || ageNum < 8 || ageNum > 18);
  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Student first name</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="given-name"
          maxLength={60}
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
            Coaching is for ages 8 to 18. Reach out at tim@xplkeyed.com if
            you&apos;re outside that range.
          </span>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Fortnite username</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="off"
          maxLength={32}
          value={state.kid_fortnite_username}
          onChange={(e) => setField("kid_fortnite_username", e.target.value)}
          placeholder="JakeFN"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Discord username</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="off"
          maxLength={32}
          value={state.kid_discord_username}
          onChange={(e) => setField("kid_discord_username", e.target.value)}
          placeholder="jakedc"
        />
        <span className={styles.fieldHint}>
          The call happens on Discord. Tim sends a server invite to this
          username before the session.
        </span>
      </label>

      {needsCoppa && (
        <CoppaGate
          state={state}
          setField={setField}
          coppa={coppa}
          canSendVerification={canSendVerification}
          requestVerification={requestVerification}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// COPPA gate — inline at L1 for under-13 players. Identical UX to
// /intake's; the only difference is the return_to threaded through.
// ---------------------------------------------------------------------------

type CoppaProps = {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  coppa: CoppaState;
  canSendVerification: boolean;
  requestVerification: () => void;
};

function CoppaGate({
  state,
  setField,
  coppa,
  canSendVerification,
  requestVerification,
}: CoppaProps) {
  const locked =
    coppa.kind === "requesting" ||
    coppa.kind === "pending" ||
    coppa.kind === "verified";
  return (
    <div className={styles.gate}>
      <div className={styles.gateHeading}>One step for your parent</div>
      <p className={styles.gateBody}>
        Because you&apos;re under 13, your parent has to approve before we go
        any further. Type their name and email, tap the button, and we&apos;ll
        send them a one tap link.
      </p>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Parent&apos;s first name</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="off"
          maxLength={80}
          value={state.parent_first_name}
          onChange={(e) => setField("parent_first_name", e.target.value)}
          placeholder="Sarah"
          disabled={locked}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Parent&apos;s email</span>
        <input
          className={styles.fieldInput}
          type="email"
          autoComplete="email"
          maxLength={254}
          value={state.parent_email}
          onChange={(e) => setField("parent_email", e.target.value)}
          placeholder="parent@example.com"
          disabled={locked}
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
          We sent an email to <b>{coppa.sentTo}</b>. Your parent should tap
          the button inside. Open the link on this same browser so your
          progress stays saved.
        </div>
      )}

      {coppa.kind === "verified" && (
        <div className={`${styles.gateStatus} ${styles.gateStatusOk}`}>
          Approved by {state.parent_first_name || "your parent"}. You can move
          on to Level 2.
        </div>
      )}

      {coppa.kind === "error" && (
        <div className={`${styles.gateStatus} ${styles.gateStatusErr}`}>
          {coppa.reason === "expired" &&
            "That link expired. Tap the button above to send a fresh one."}
          {coppa.reason === "not_found" &&
            "We couldn't match that link. Tap the button to send a new one."}
          {coppa.reason === "server" &&
            "Something went sideways on our end. Try again."}
          {coppa.reason === "send_failed" &&
            "We couldn't send the email. Check the address and try again."}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 2 — Skill Check
// ---------------------------------------------------------------------------

type Level2Props = {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
};

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
          <option value="">Pick one</option>
          {RANK_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Platform</span>
        <select
          className={styles.fieldSelect}
          value={state.kid_platform}
          onChange={(e) => setField("kid_platform", e.target.value)}
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
        <span className={styles.fieldLabel}>Hours per week playing</span>
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
        <span className={styles.fieldHint}>
          Rough estimate is fine. Helps Tim pace the session.
        </span>
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Level 3 — Parent Contact (or locked-already-verified view for under-13)
// ---------------------------------------------------------------------------

type Level3Props = {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  lockedByCoppa: boolean;
};

function Level3({ state, setField, lockedByCoppa }: Level3Props) {
  if (lockedByCoppa) {
    return (
      <div className={pay.lockedParent}>
        <div className={pay.lockedParentHead}>Parent on file</div>
        <div className={pay.lockedParentRow}>
          <span>{state.parent_first_name}</span>
          <span>{state.parent_email}</span>
        </div>
        <p className={pay.lockedParentHint}>
          Tap Back, then go back one more time to Level 1 if you need to
          change this. Re-verification will be required.
        </p>
      </div>
    );
  }
  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Parent&apos;s first name</span>
        <input
          className={styles.fieldInput}
          type="text"
          autoComplete="given-name"
          maxLength={80}
          value={state.parent_first_name}
          onChange={(e) => setField("parent_first_name", e.target.value)}
          placeholder="Sarah"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Parent&apos;s email</span>
        <input
          className={styles.fieldInput}
          type="email"
          autoComplete="email"
          maxLength={254}
          value={state.parent_email}
          onChange={(e) => setField("parent_email", e.target.value)}
          placeholder="parent@example.com"
        />
        <span className={styles.fieldHint}>
          The Stripe receipt and the scheduling link land here.
        </span>
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Level 4 — "What" textarea + Pay $24 block. Tim reads the textarea and
// picks the lesson; the parent doesn't pick from a catalog.
// ---------------------------------------------------------------------------

type Level4Props = {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  submitError: string | null;
};

function Level4({
  state,
  setField,
  onSubmit,
  submitting,
  canSubmit,
  submitError,
}: Level4Props) {
  const firstName = state.kid_first_name.trim() || "the player";
  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          What does {firstName} want help with?
        </span>
        <textarea
          className={pay.textarea}
          value={state.what_to_help_with}
          onChange={(e) => setField("what_to_help_with", e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Example: He gets third partied a lot when he wins fights and wants to learn how to rotate faster."
        />
        <span className={styles.fieldHint}>
          One or two sentences. Tim reads this and picks the lesson from his
          library that fits. If nothing in his library is right, he builds
          one for the session.
        </span>
      </label>

      <div className={pay.payBlock}>
        <div className={pay.payAmount}>
          $24<span className={pay.payUnit}>· one session</span>
        </div>
        <p className={pay.payBody}>
          30 minutes on Discord with Tim plus the lesson materials to keep.
          No subscription. Stripe handles the payment securely.
        </p>
        <button
          type="button"
          className={pay.payCta}
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? "Opening Stripe Checkout..." : "Pay $24 and continue"}
        </button>
        {submitError && (
          <p className={pay.payError}>
            Something went wrong (<code>{submitError}</code>). Try again, or
            email <a href="mailto:tim@xplkeyed.com">tim@xplkeyed.com</a> if
            it keeps failing.
          </p>
        )}
      </div>
    </>
  );
}
