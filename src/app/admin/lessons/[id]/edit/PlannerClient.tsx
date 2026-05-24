"use client";

// PlannerClient
// -------------
// React port of the Coach Keyed Lesson Planner (originally at
// tools/coach-keyed-planner/). 7-step authoring flow with AI helpers
// at Steps 2 to 5. Replaces the slide-era LessonForm + LessonEditForm.
//
// State management:
//   * Single in-memory state object mirroring the planner schema.
//   * Autosave via debounced PATCH to /api/admin/lessons/[id]. Saves
//     250ms after the last edit. Granular enough that no full step
//     transition is needed to persist.
//   * The lesson row's DB columns are split: beat_sheet + terms +
//     video_url + publish metadata live as top-level columns (read by
//     Sunday cron + viewers). Everything else (rough draft, watch
//     notes, identify list, dependency flags, review checks, current
//     step) lives in planner_state JSONB and is editor-only.
//
// AI helpers post to /api/admin/lessons/ai-suggest with kind values
// `read_summary`, `identify_breakdown`, `narrow_recommend`,
// `write_structure`. Output drops into editable fields; never
// auto-overwrites without user action.
//
// Capstone Mode v1: the dependency answer + the "you planned an
// N-part series" reveal are surfaced as insight. Series-spawning
// (creating N new lesson rows) is deferred — Tim manually creates
// each lesson for now. The data is preserved on this lesson so a
// future enhancement can spawn the series from it.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TranscribeUploader from "./TranscribeUploader";
import styles from "./planner.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IdentifyItem = { id: string; name: string; description: string };
export type BreakdownItem = { bullet: string; why: string };
export type Term = { word: string; definition: string };
export type ParentTalkingPoint = { category: string; text: string };
export type BeatSheet = {
  hook: string;
  goal: string;
  demonstration: string;
  breakdown: BreakdownItem[];
  commonMistake: string;
  practiceSetup: string;
  summary: string;
  outro: string;
};
export type PlannerStateJson = {
  currentStep: number;
  roughDraft: string;
  watchNotes: { clipDescription: string; mainGoal: string };
  identifyList: IdentifyItem[];
  isCapstone: boolean;
  dependencyAnswered: boolean;
  narrowChoice: string | null;
  curriculumOrder: string[] | null;
  assumesPrerequisites: boolean;
  reviewChecks: { oneIdea: boolean; definitions: boolean; why: boolean; pacing: boolean };
  // Standard Mode tracker. Set after spawn-independent runs; presence
  // marks "already spawned" so the UI can show the done state instead
  // of letting Tim re-spawn and create duplicates.
  spawnedIndependentLessonIds?: string[];
};
export type LessonRecord = {
  id: string;
  title: string;
  fortniteLabel: string | null;
  parentLabel: string | null;
  parentSkillDescription: string | null;
  topic: string | null;
  difficultyLevel: string | null;
  durationMinutes: number | null;
  isPublished: boolean;
  videoUrl: string | null;
  beatSheet: BeatSheet | null;
  terms: Term[] | null;
  plannerState: PlannerStateJson | null;
  parentTalkingPoints: ParentTalkingPoint[] | null;
  seriesId: string | null;
  seriesPosition: number | null;
};

// ---------------------------------------------------------------------------
// Defaults + helpers
// ---------------------------------------------------------------------------

const STEP_LABELS = ["Rough draft", "Read", "Identify", "Narrow", "Write", "Review", "Publish"];

const TOPICS = ["building", "editing", "aim", "game_sense", "mental", "tournament_prep"] as const;
const DIFFICULTIES = ["beginner", "intermediate", "advanced", "unreal"] as const;

const BEAT_SECTIONS: Array<{
  key: keyof Omit<BeatSheet, "breakdown">;
  title: string;
  hint: string;
}> = [
  { key: "hook", title: "Hook", hint: 'One sentence that grabs attention. "What if you could ___?"' },
  { key: "goal", title: "Goal", hint: '"Today I\'ll teach you ___. By the end you\'ll know how to ___."' },
  { key: "demonstration", title: "Demonstration", hint: "Notes on the clip to show. What to point to. When to pause." },
  { key: "commonMistake", title: "Common mistake", hint: "What beginners do wrong, and why the right way is better." },
  { key: "practiceSetup", title: "Practice setup", hint: "How to practice this in Creative mode." },
  { key: "summary", title: "Summary", hint: "2 to 3 bullets restating the key idea." },
  { key: "outro", title: "Outro", hint: 'Short and clean. "Next lesson: ___."' },
];

function uid() {
  return "i_" + Math.random().toString(36).slice(2, 10);
}

function defaultBeatSheet(): BeatSheet {
  return {
    hook: "",
    goal: "",
    demonstration: "",
    breakdown: [{ bullet: "", why: "" }],
    commonMistake: "",
    practiceSetup: "",
    summary: "",
    outro: "",
  };
}

function defaultPlannerState(): PlannerStateJson {
  return {
    currentStep: 1,
    roughDraft: "",
    watchNotes: { clipDescription: "", mainGoal: "" },
    identifyList: [
      { id: uid(), name: "", description: "" },
      { id: uid(), name: "", description: "" },
    ],
    isCapstone: false,
    dependencyAnswered: false,
    narrowChoice: null,
    curriculumOrder: null,
    assumesPrerequisites: false,
    reviewChecks: { oneIdea: false, definitions: false, why: false, pacing: false },
  };
}

function deriveTitle(s: PlannerStateJson): string {
  const goal = s.watchNotes.mainGoal.trim();
  if (goal) return goal.slice(0, 80);
  if (s.narrowChoice) {
    const item = s.identifyList.find((it) => it.id === s.narrowChoice);
    if (item && item.name.trim()) return item.name.trim();
  }
  return "Untitled lesson";
}

function wordCount(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readMinutes(beat: BeatSheet, terms: Term[]): number {
  let words = 0;
  (["hook", "goal", "demonstration", "commonMistake", "practiceSetup", "summary", "outro"] as const).forEach((k) => {
    words += wordCount(beat[k] || "");
  });
  (beat.breakdown || []).forEach((b) => {
    words += wordCount(b.bullet) + wordCount(b.why);
  });
  (terms || []).forEach((t) => {
    words += wordCount(t.definition);
  });
  return Math.max(0.5, (words / 150) * 1.3);
}

// Best-effort video embed URL detection. Returns an iframe src for
// YouTube + Vimeo + Loom; null for everything else (caller falls back
// to a "Watch on <domain>" link).
function videoEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // YouTube watch + youtu.be + shorts
  const yt = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // Vimeo
  const vm = trimmed.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  // Loom share/embed
  const lm = trimmed.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/);
  if (lm) return `https://www.loom.com/embed/${lm[1]}`;
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PendingSave = {
  beat_sheet?: BeatSheet;
  terms?: Term[];
  planner_state?: PlannerStateJson;
  title?: string;
  video_url?: string | null;
  fortnite_label?: string | null;
  parent_label?: string | null;
  parent_skill_description?: string | null;
  topic?: string | null;
  difficulty_level?: string | null;
  duration_minutes?: number | null;
  is_published?: boolean;
  parent_talking_points?: ParentTalkingPoint[];
};

type AiKind =
  | "read_summary"
  | "identify_breakdown"
  | "narrow_recommend"
  | "write_structure"
  | "parent_translation";

export default function PlannerClient({ initial }: { initial: LessonRecord }) {
  // Hydrate state from server-provided record. Missing JSONB fields
  // fall back to defaults so the planner is always usable even on a
  // brand-new draft.
  const [lessonId] = useState(initial.id);
  const [title, setTitle] = useState(initial.title);
  const [planner, setPlanner] = useState<PlannerStateJson>(
    initial.plannerState ?? defaultPlannerState(),
  );
  const [beatSheet, setBeatSheet] = useState<BeatSheet>(
    initial.beatSheet ?? defaultBeatSheet(),
  );
  const [terms, setTerms] = useState<Term[]>(
    initial.terms ?? [{ word: "", definition: "" }],
  );
  const [videoUrl, setVideoUrl] = useState<string>(initial.videoUrl ?? "");
  const [fortniteLabel, setFortniteLabel] = useState<string>(initial.fortniteLabel ?? "");
  const [parentLabel, setParentLabel] = useState<string>(initial.parentLabel ?? "");
  const [parentSkillDescription, setParentSkillDescription] = useState<string>(
    initial.parentSkillDescription ?? "",
  );
  const [topic, setTopic] = useState<string>(initial.topic ?? "");
  const [difficultyLevel, setDifficultyLevel] = useState<string>(initial.difficultyLevel ?? "");
  const [durationMinutes, setDurationMinutes] = useState<string>(
    initial.durationMinutes != null ? String(initial.durationMinutes) : "",
  );
  const [isPublished, setIsPublished] = useState<boolean>(initial.isPublished);
  const [parentTalkingPoints, setParentTalkingPoints] = useState<ParentTalkingPoint[]>(
    initial.parentTalkingPoints ?? [],
  );

  const [saving, setSaving] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [aiState, setAiState] = useState<{ kind: AiKind | null; busy: boolean; error: string | null }>({
    kind: null,
    busy: false,
    error: null,
  });

  // Save debounce.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingSave>({});

  // Save: merge `patch` into pending, debounce 250ms, fire PATCH.
  const queueSave = useCallback((patch: PendingSave) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving("pending");
    saveTimerRef.current = setTimeout(async () => {
      const body = pendingRef.current;
      pendingRef.current = {};
      setSaving("saving");
      try {
        const res = await fetch(`/api/admin/lessons/${lessonId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setSaving("error");
          return;
        }
        setSaving("saved");
        setTimeout(() => setSaving((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch {
        setSaving("error");
      }
    }, 250);
  }, [lessonId]);

  // Compose-then-save helpers for each domain.
  const setPlannerAndSave = useCallback(
    (updater: (p: PlannerStateJson) => PlannerStateJson) => {
      setPlanner((prev) => {
        const next = updater(prev);
        const derivedTitle = deriveTitle(next);
        queueSave({ planner_state: next, title: derivedTitle });
        if (derivedTitle !== title) setTitle(derivedTitle);
        return next;
      });
    },
    [queueSave, title],
  );

  const setBeatAndSave = useCallback(
    (updater: (b: BeatSheet) => BeatSheet) => {
      setBeatSheet((prev) => {
        const next = updater(prev);
        queueSave({ beat_sheet: next });
        return next;
      });
    },
    [queueSave],
  );

  const setTermsAndSave = useCallback(
    (updater: (t: Term[]) => Term[]) => {
      setTerms((prev) => {
        const next = updater(prev);
        queueSave({ terms: next });
        return next;
      });
    },
    [queueSave],
  );

  // Step gating.
  const namedItems = useMemo(
    () => planner.identifyList.filter((it) => it.name.trim().length > 0),
    [planner.identifyList],
  );

  const stepComplete = useCallback(
    (n: number): boolean => {
      if (n === 1) return planner.roughDraft.trim().length > 0;
      if (n === 2) return planner.watchNotes.clipDescription.trim() !== "" && planner.watchNotes.mainGoal.trim() !== "";
      if (n === 3) return namedItems.length >= 2 && planner.dependencyAnswered;
      if (n === 4) {
        if (planner.isCapstone) return planner.curriculumOrder != null && planner.curriculumOrder.length >= 2;
        return planner.narrowChoice !== null;
      }
      if (n === 5) {
        const bs = beatSheet;
        const allText = bs.hook && bs.goal && bs.demonstration && bs.commonMistake && bs.practiceSetup && bs.summary && bs.outro;
        const hasBreakdown = bs.breakdown.some((b) => b.bullet.trim());
        const hasTerm = terms.some((t) => t.word.trim() && t.definition.trim());
        return Boolean(allText && hasBreakdown && hasTerm);
      }
      if (n === 6) {
        const c = planner.reviewChecks;
        return c.oneIdea && c.definitions && c.why && c.pacing;
      }
      if (n === 7) {
        return (
          videoUrl.trim().length > 0 &&
          fortniteLabel.trim().length > 0 &&
          parentLabel.trim().length > 0 &&
          parentSkillDescription.trim().length > 0 &&
          topic !== "" &&
          difficultyLevel !== "" &&
          durationMinutes.trim() !== ""
        );
      }
      return false;
    },
    [planner, beatSheet, terms, namedItems, videoUrl, fortniteLabel, parentLabel, parentSkillDescription, topic, difficultyLevel, durationMinutes],
  );

  const maxAccessibleStep = useMemo(() => {
    for (let n = 1; n <= 6; n++) {
      if (!stepComplete(n)) return n;
    }
    return 7;
  }, [stepComplete]);

  const goToStep = useCallback(
    (n: number) => {
      if (n < 1 || n > 7) return;
      const target = Math.min(n, maxAccessibleStep);
      setPlannerAndSave((p) => ({ ...p, currentStep: target }));
    },
    [maxAccessibleStep, setPlannerAndSave],
  );

  // AI helper: posts to ai-suggest, returns parsed suggestion.
  const askAi = useCallback(
    async (kind: AiKind, body: Record<string, unknown>): Promise<unknown> => {
      setAiState({ kind, busy: true, error: null });
      try {
        const res = await fetch("/api/admin/lessons/ai-suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, ...body }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; suggestion?: unknown; error?: string };
        if (!res.ok || !data.ok) {
          setAiState({ kind, busy: false, error: data.error ?? "ai_failed" });
          return null;
        }
        setAiState({ kind: null, busy: false, error: null });
        return data.suggestion;
      } catch {
        setAiState({ kind, busy: false, error: "network" });
        return null;
      }
    },
    [],
  );

  // ---- Publish ----------------------------------------------------------

  const publish = useCallback(async () => {
    queueSave({
      video_url: videoUrl.trim(),
      fortnite_label: fortniteLabel.trim(),
      parent_label: parentLabel.trim(),
      parent_skill_description: parentSkillDescription.trim(),
      topic: topic || null,
      difficulty_level: difficultyLevel || null,
      duration_minutes: parseInt(durationMinutes, 10),
      parent_talking_points: parentTalkingPoints,
      is_published: true,
    });
    setIsPublished(true);
  }, [
    queueSave,
    videoUrl,
    fortniteLabel,
    parentLabel,
    parentSkillDescription,
    topic,
    difficultyLevel,
    durationMinutes,
    parentTalkingPoints,
  ]);

  const unpublish = useCallback(() => {
    queueSave({ is_published: false });
    setIsPublished(false);
  }, [queueSave]);

  // ---- Render -----------------------------------------------------------

  const step = planner.currentStep;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <Link href="/admin/lessons" className={styles.backLink}>Back to library</Link>
          <h1 className={styles.shellTitle}>{title || "Untitled lesson"}</h1>
        </div>
        <div className={styles.topbarMeta}>
          <span className={styles.savingPill} data-state={saving}>{savingLabel(saving)}</span>
          {isPublished ? <span className={styles.publishedPill}>Published</span> : null}
        </div>
      </header>

      <div className={styles.row}>
        <aside className={styles.rail}>
          <div className={styles.railTitle}>Lesson plan</div>
          <ul className={styles.stepList}>
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              const done = n < step && stepComplete(n);
              const isCurrent = n === step;
              const accessible = n <= maxAccessibleStep;
              const cls = [
                styles.stepItem,
                isCurrent ? styles.stepItemCurrent : "",
                done && !isCurrent ? styles.stepItemDone : "",
                accessible && !isCurrent ? styles.stepItemClickable : "",
              ].filter(Boolean).join(" ");
              return (
                <li
                  key={n}
                  className={cls}
                  onClick={accessible && !isCurrent ? () => goToStep(n) : undefined}
                >
                  <span className={styles.stepNum}>{done && !isCurrent ? "✓" : n}</span>
                  <span className={styles.stepName}>{label}</span>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className={styles.main}>
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {step === 5 && renderStep5()}
          {step === 6 && renderStep6()}
          {step === 7 && renderStep7()}
        </main>
      </div>
    </div>
  );

  // -------------------------------------------------------------------------
  // Step renderers (closures over state to keep the file compact)
  // -------------------------------------------------------------------------

  function renderStep1() {
    const canAdvance = stepComplete(1);
    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Step 1 of 7</div>
        <h2 className={styles.cardTitle}>Your rough draft</h2>
        <p className={styles.cardHint}>
          Drag in a video and we&apos;ll transcribe it for you, or paste a
          transcript / bullet points directly into the box. Doesn&apos;t need
          to be perfect. You just need enough raw material to look at and
          analyze.
        </p>
        <TranscribeUploader
          lessonId={lessonId}
          existingDraftLength={planner.roughDraft.length}
          onTranscript={(text, mode) => {
            setPlannerAndSave((p) => ({
              ...p,
              roughDraft:
                mode === "replace"
                  ? text
                  : p.roughDraft
                    ? `${p.roughDraft}\n\n${text}`
                    : text,
            }));
          }}
        />
        <textarea
          className={`${styles.fieldTextarea} ${styles.tall}`}
          value={planner.roughDraft}
          onChange={(e) =>
            setPlannerAndSave((p) => ({ ...p, roughDraft: e.target.value }))
          }
          placeholder="Paste transcript or list bullets of what you said in the rough draft..."
        />
        <div className={styles.btnRowSpread}>
          <Link href="/admin/lessons" className={`${styles.btn} ${styles.btnGhost}`}>
            Save and go to library
          </Link>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!canAdvance}
            onClick={() => goToStep(2)}
          >
            Lock it in
          </button>
        </div>
      </section>
    );
  }

  function renderStep2() {
    const canAdvance = stepComplete(2);
    const busy = aiState.busy && aiState.kind === "read_summary";
    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Step 2 of 7</div>
        <h2 className={styles.cardTitle}>Read your rough draft back. Out loud is better.</h2>
        <p className={styles.cardHint}>
          Then answer the two questions below. Or tap the AI button to draft them from your transcript.
          You can edit anything it writes.
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnAi}`}
          disabled={busy || !planner.roughDraft.trim()}
          onClick={async () => {
            const sug = (await askAi("read_summary", { rough_draft: planner.roughDraft })) as
              | { clip_description?: string; main_goal?: string }
              | null;
            if (!sug) return;
            setPlannerAndSave((p) => ({
              ...p,
              watchNotes: {
                clipDescription: sug.clip_description ?? p.watchNotes.clipDescription,
                mainGoal: sug.main_goal ?? p.watchNotes.mainGoal,
              },
            }));
          }}
        >
          {busy ? "Drafting from transcript..." : "✨ Draft from transcript"}
        </button>
        {aiState.error && aiState.kind === "read_summary" ? (
          <p className={styles.aiError}>AI call failed ({aiState.error}). Edit the fields manually.</p>
        ) : null}

        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            What clip is this lesson about? What happened in the gameplay?
          </label>
          <textarea
            className={`${styles.fieldTextarea} ${styles.small}`}
            value={planner.watchNotes.clipDescription}
            onChange={(e) =>
              setPlannerAndSave((p) => ({
                ...p,
                watchNotes: { ...p.watchNotes, clipDescription: e.target.value },
              }))
            }
            placeholder="Example: I won a 1v1 in Zero Build by holding pressure on the right side..."
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            What&apos;s the main thing you were trying to teach?
          </label>
          <input
            type="text"
            className={styles.fieldInput}
            value={planner.watchNotes.mainGoal}
            onChange={(e) =>
              setPlannerAndSave((p) => ({
                ...p,
                watchNotes: { ...p.watchNotes, mainGoal: e.target.value },
              }))
            }
            placeholder="Example: How to use diagonal pressure to win a 1v1."
            maxLength={120}
          />
        </div>
        <div className={styles.btnRowSpread}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => goToStep(1)}
          >
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!canAdvance}
            onClick={() => goToStep(3)}
          >
            Lock it in
          </button>
        </div>
      </section>
    );
  }

  function renderStep3() {
    const items = planner.identifyList;
    const showDep = namedItems.length >= 2;
    const canAdvance = stepComplete(3);
    const busy = aiState.busy && aiState.kind === "identify_breakdown";
    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Step 3 of 7</div>
        <h2 className={styles.cardTitle}>List every separate thing you ended up teaching.</h2>
        <p className={styles.cardHint}>
          Be honest. Most rough drafts cover more than one. Tap the AI button to break the transcript apart, then edit.
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnAi}`}
          disabled={busy || !planner.roughDraft.trim()}
          onClick={async () => {
            const sug = (await askAi("identify_breakdown", { rough_draft: planner.roughDraft })) as
              | { items?: Array<{ name?: string; description?: string }> }
              | null;
            if (!sug || !Array.isArray(sug.items)) return;
            const next: IdentifyItem[] = sug.items.slice(0, 8).map((it) => ({
              id: uid(),
              name: (it.name ?? "").slice(0, 80),
              description: (it.description ?? "").slice(0, 200),
            }));
            // Pad to at least 2 so the rest of the UI behaves.
            while (next.length < 2) next.push({ id: uid(), name: "", description: "" });
            setPlannerAndSave((p) => ({ ...p, identifyList: next, dependencyAnswered: false, isCapstone: false, narrowChoice: null, curriculumOrder: null }));
          }}
        >
          {busy ? "Breaking it down..." : "✨ Break the transcript apart"}
        </button>
        {aiState.error && aiState.kind === "identify_breakdown" ? (
          <p className={styles.aiError}>AI call failed ({aiState.error}).</p>
        ) : null}

        <div className={styles.identifyList}>
          {items.map((item, idx) => (
            <div className={styles.identifyItem} key={item.id}>
              <div className={styles.identifyNum}>{idx + 1}</div>
              <div className={styles.identifyBody}>
                <input
                  type="text"
                  className={styles.identifyNameInput}
                  placeholder="Skill name (e.g., Diagonal pressure)"
                  value={item.name}
                  onChange={(e) =>
                    setPlannerAndSave((p) => ({
                      ...p,
                      identifyList: p.identifyList.map((it) =>
                        it.id === item.id ? { ...it, name: e.target.value } : it,
                      ),
                    }))
                  }
                  maxLength={80}
                />
                <input
                  type="text"
                  className={styles.identifyDescInput}
                  placeholder="One-line description (optional)"
                  value={item.description}
                  onChange={(e) =>
                    setPlannerAndSave((p) => ({
                      ...p,
                      identifyList: p.identifyList.map((it) =>
                        it.id === item.id ? { ...it, description: e.target.value } : it,
                      ),
                    }))
                  }
                  maxLength={200}
                />
              </div>
              <div className={styles.identifyActions}>
                <button
                  type="button"
                  className={styles.arrowBtn}
                  disabled={idx === 0}
                  onClick={() => {
                    setPlannerAndSave((p) => {
                      const arr = [...p.identifyList];
                      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                      return { ...p, identifyList: arr };
                    });
                  }}
                  aria-label="Move up"
                >↑</button>
                <button
                  type="button"
                  className={styles.arrowBtn}
                  disabled={idx === items.length - 1}
                  onClick={() => {
                    setPlannerAndSave((p) => {
                      const arr = [...p.identifyList];
                      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                      return { ...p, identifyList: arr };
                    });
                  }}
                  aria-label="Move down"
                >↓</button>
                {items.length > 2 ? (
                  <button
                    type="button"
                    className={styles.xBtn}
                    onClick={() =>
                      setPlannerAndSave((p) => ({
                        ...p,
                        identifyList: p.identifyList.filter((it) => it.id !== item.id),
                      }))
                    }
                    aria-label="Remove"
                  >×</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnTiny} ${styles.btnGhost}`}
          onClick={() =>
            setPlannerAndSave((p) => ({
              ...p,
              identifyList: [...p.identifyList, { id: uid(), name: "", description: "" }],
            }))
          }
        >
          + Add another
        </button>

        {showDep ? (
          <div className={styles.depQuestion}>
            <h4>How do these relate to each other?</h4>
            <p>
              This is the call that shapes everything downstream. Be honest
              about whether your skills depend on each other or not.
            </p>
            <p className={styles.coreLockHint}>
              You answer this one yourself. No AI.
            </p>
            <div className={styles.depOptions}>
              <button
                type="button"
                className={`${styles.depOption} ${planner.dependencyAnswered && !planner.isCapstone ? styles.depOptionChosen : ""}`}
                onClick={() =>
                  setPlannerAndSave((p) => ({
                    ...p,
                    isCapstone: false,
                    dependencyAnswered: true,
                    curriculumOrder: null,
                  }))
                }
              >
                <div className={styles.depOptionTitle}>Independent skills</div>
                <div className={styles.depOptionBody}>
                  Each of these can stand alone. A player could watch any one in any order. No prerequisites between them.
                </div>
              </button>
              <button
                type="button"
                className={`${styles.depOption} ${planner.dependencyAnswered && planner.isCapstone ? styles.depOptionChosen : ""}`}
                onClick={() =>
                  setPlannerAndSave((p) => ({
                    ...p,
                    isCapstone: true,
                    dependencyAnswered: true,
                    curriculumOrder: p.identifyList
                      .filter((it) => it.name.trim())
                      .map((it) => it.id),
                  }))
                }
              >
                <div className={styles.depOptionTitle}>They build on each other</div>
                <div className={styles.depOptionBody}>
                  Each one uses ideas from the previous. A beginner has to watch them in order. The last lesson pulls everything together.
                </div>
              </button>
            </div>
          </div>
        ) : (
          <p className={styles.fieldHint}>Add at least 2 items to see the next question.</p>
        )}

        <div className={styles.btnRowSpread}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => goToStep(2)}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!canAdvance}
            onClick={() => goToStep(4)}
          >
            Lock it in
          </button>
        </div>
      </section>
    );
  }

  function renderStep4() {
    const items = namedItems;
    const isCapstone = planner.isCapstone;
    if (isCapstone) return renderStep4Capstone(items);
    return renderStep4Standard(items);
  }

  function renderStep4Standard(items: IdentifyItem[]) {
    const chosen = planner.narrowChoice;
    const canAdvance = chosen !== null;
    const unchosen = items.filter((it) => it.id !== chosen);
    const busy = aiState.busy && aiState.kind === "narrow_recommend";

    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Step 4 of 7 · Independent skills</div>
        <h2 className={styles.cardTitle}>Pick ONE skill to teach in this video.</h2>
        <p className={styles.cardHint}>
          Each skill on your list stands on its own. Pick the one to focus
          on now. Below, you can spawn the rest as their own independent
          draft lessons (they won&apos;t be tied together — Tim can group them later
          under a bundle if he wants).
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnAi}`}
          disabled={busy || items.length < 2}
          onClick={async () => {
            const sug = (await askAi("narrow_recommend", {
              items: items.map((it) => ({ id: it.id, name: it.name, description: it.description })),
            })) as
              | { ranked_ids?: string[]; reasoning?: Record<string, string>; recommended_first_id?: string }
              | null;
            if (!sug || !sug.recommended_first_id) return;
            const recommended = items.find((it) => it.id === sug.recommended_first_id);
            if (recommended) {
              setPlannerAndSave((p) => ({ ...p, narrowChoice: recommended.id }));
            }
            // Save the reasoning into the identify list descriptions if Tim
            // hasn't typed his own.
            if (sug.reasoning) {
              setPlannerAndSave((p) => ({
                ...p,
                identifyList: p.identifyList.map((it) => {
                  const r = sug.reasoning?.[it.id];
                  if (r && !it.description.trim()) return { ...it, description: r };
                  return it;
                }),
              }));
            }
          }}
        >
          {busy ? "Thinking..." : "✨ Recommend which to teach first"}
        </button>
        {aiState.error && aiState.kind === "narrow_recommend" ? (
          <p className={styles.aiError}>AI call failed ({aiState.error}).</p>
        ) : null}

        <div className={styles.narrowOptions}>
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`${styles.narrowOption} ${chosen === item.id ? styles.narrowOptionChosen : ""}`}
              onClick={() => setPlannerAndSave((p) => ({ ...p, narrowChoice: item.id }))}
            >
              <span className={styles.narrowOptionName}>
                {item.name} {chosen === item.id ? "✓" : ""}
              </span>
              {item.description ? (
                <span className={styles.narrowOptionDesc}>{item.description}</span>
              ) : null}
            </button>
          ))}
        </div>

        {chosen && unchosen.length > 0 ? (
          <div className={styles.futureQueue}>
            <h4>The other {unchosen.length} skill{unchosen.length === 1 ? "" : "s"}</h4>
            <ul>
              {unchosen.map((it) => (
                <li key={it.id}>
                  {it.name}
                  {it.description ? ` — ${it.description}` : ""}
                </li>
              ))}
            </ul>
            <p className={styles.fieldHint}>
              Spawn these as independent draft lessons now, or come back
              later. Either way each one stands on its own — no implied
              order, no series binding.
            </p>
            <SpawnIndependentButton
              lessonId={lessonId}
              count={unchosen.length}
              alreadySpawned={
                Array.isArray(planner.spawnedIndependentLessonIds) &&
                planner.spawnedIndependentLessonIds.length > 0
              }
              onSpawned={(ids) => {
                setPlannerAndSave((p) => ({
                  ...p,
                  spawnedIndependentLessonIds: ids,
                }));
              }}
            />
          </div>
        ) : null}

        <div className={styles.btnRowSpread}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => goToStep(3)}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!canAdvance}
            onClick={() => goToStep(5)}
          >
            Lock it in
          </button>
        </div>
      </section>
    );
  }

  function renderStep4Capstone(items: IdentifyItem[]) {
    const order = planner.curriculumOrder ?? items.map((it) => it.id);
    const orderedItems = order.map((id) => items.find((it) => it.id === id)).filter(Boolean) as IdentifyItem[];
    const N = orderedItems.length;
    const canAdvance = N >= 2;

    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Step 4 of 7 · Sequential series</div>
        <h2 className={styles.cardTitle}>Put them in teaching order.</h2>
        <p className={styles.cardHint}>
          Order them so each one scaffolds the next. The first lesson covers
          what a beginner needs before they can grasp the second; the last
          synthesizes the whole series. This lesson becomes the capstone.
        </p>
        <div className={styles.identifyList}>
          {orderedItems.map((item, idx) => (
            <div className={styles.identifyItem} key={item.id}>
              <div className={styles.identifyNum}>{idx + 1}</div>
              <div className={styles.identifyBody}>
                <div className={styles.capstoneName}>{item.name}</div>
                {item.description ? (
                  <div className={styles.capstoneDesc}>{item.description}</div>
                ) : null}
              </div>
              <div className={styles.identifyActions}>
                <button
                  type="button"
                  className={styles.arrowBtn}
                  disabled={idx === 0}
                  onClick={() => {
                    setPlannerAndSave((p) => {
                      const arr = [...(p.curriculumOrder ?? order)];
                      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                      return { ...p, curriculumOrder: arr };
                    });
                  }}
                  aria-label="Move up"
                >↑</button>
                <button
                  type="button"
                  className={styles.arrowBtn}
                  disabled={idx === N - 1}
                  onClick={() => {
                    setPlannerAndSave((p) => {
                      const arr = [...(p.curriculumOrder ?? order)];
                      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                      return { ...p, curriculumOrder: arr };
                    });
                  }}
                  aria-label="Move down"
                >↓</button>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.capstoneReveal}>
          <h3>You just designed a {N + 1}-part series.</h3>
          <ul className={styles.capstoneList}>
            {orderedItems.map((it, idx) => (
              <li key={it.id}>
                <span className={styles.capstoneLessonNum}>LESSON {idx + 1}</span>
                <span className={styles.capstoneLessonName}>{it.name}</span>
                <span className={styles.capstoneLessonTag}>
                  {idx === 0 ? "foundation" : `builds on lesson ${idx}`}
                </span>
              </li>
            ))}
            <li>
              <span className={styles.capstoneLessonNum}>LESSON {N + 1}</span>
              <span className={styles.capstoneLessonName}>Putting it all together</span>
              <span className={styles.capstoneLessonTag}>your original rough draft, re-recorded</span>
            </li>
          </ul>
          <p className={styles.fieldHint}>
            Tap &ldquo;Spawn series stubs&rdquo; below to create the {N} foundation lessons
            now. Each lands in your library as a draft with its name + a head start in the planner.
            This lesson becomes the capstone at position {N + 1}.
          </p>
        </div>

        <SpawnSeriesButton
          lessonId={lessonId}
          itemCount={N}
          alreadySpawned={initial.seriesId === initial.id}
        />

        <div className={styles.btnRowSpread}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => goToStep(3)}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!canAdvance}
            onClick={() => {
              // After spawning OR if Tim wants to skip spawning and work on
              // the capstone directly: pretend "narrow chose first item" so
              // Step 5 onward operates on something. If he spawned children
              // the capstone's beat sheet ends up being the "putting it all
              // together" review.
              const firstId = orderedItems[0]?.id;
              if (firstId) {
                setPlannerAndSave((p) => ({ ...p, narrowChoice: firstId }));
              }
              goToStep(5);
            }}
          >
            Plan capstone lesson →
          </button>
        </div>
      </section>
    );
  }

  function renderStep5() {
    const canAdvance = stepComplete(5);
    const busy = aiState.busy && aiState.kind === "write_structure";
    const chosen = planner.identifyList.find((it) => it.id === planner.narrowChoice);
    const isCapstone = planner.isCapstone;
    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>
          Step 5 of 7{isCapstone ? " · Capstone synthesis" : ""}
        </div>
        <h2 className={styles.cardTitle}>
          {isCapstone ? "Plan the capstone." : "Build your beat sheet."}
        </h2>
        <p className={styles.cardHint}>
          {isCapstone ? (
            <>
              This is the lesson that ties everything together. Reference the
              foundation lessons your viewer should have watched first; don&apos;t
              re-teach those mechanics from scratch — synthesize them into
              the bigger play. Bullets, not sentences.
            </>
          ) : (
            <>
              Bullets, not sentences. You talk in your own voice from the
              bullets. Tap the AI button to draft a starting structure, then
              edit every section.
            </>
          )}
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnAi}`}
          disabled={busy || !chosen}
          onClick={async () => {
            if (!chosen) return;
            const sug = (await askAi("write_structure", {
              rough_draft: planner.roughDraft,
              main_goal: planner.watchNotes.mainGoal,
              clip_description: planner.watchNotes.clipDescription,
              chosen_skill: { name: chosen.name, description: chosen.description || undefined },
            })) as
              | (Partial<BeatSheet> & { common_mistake?: string; practice_setup?: string; terms?: Term[] })
              | null;
            if (!sug) return;
            setBeatAndSave((b) => ({
              hook: sug.hook ?? b.hook,
              goal: sug.goal ?? b.goal,
              demonstration: sug.demonstration ?? b.demonstration,
              breakdown:
                Array.isArray(sug.breakdown) && sug.breakdown.length > 0
                  ? sug.breakdown.map((br) => ({ bullet: br.bullet ?? "", why: br.why ?? "" }))
                  : b.breakdown,
              commonMistake: sug.common_mistake ?? sug.commonMistake ?? b.commonMistake,
              practiceSetup: sug.practice_setup ?? sug.practiceSetup ?? b.practiceSetup,
              summary: sug.summary ?? b.summary,
              outro: sug.outro ?? b.outro,
            }));
            if (Array.isArray(sug.terms) && sug.terms.length > 0) {
              setTermsAndSave(() => sug.terms!.map((t) => ({ word: t.word ?? "", definition: t.definition ?? "" })));
            }
          }}
        >
          {busy ? "Drafting..." : "✨ Draft a starting structure"}
        </button>
        {aiState.error && aiState.kind === "write_structure" ? (
          <p className={styles.aiError}>AI call failed ({aiState.error}).</p>
        ) : null}

        {BEAT_SECTIONS.map((sec) => (
          <div className={styles.beatSection} key={sec.key}>
            <div className={styles.beatHeader}>
              <div>
                <div className={styles.beatTitle}>{sec.title}</div>
                <div className={styles.beatHint}>{sec.hint}</div>
              </div>
            </div>
            <div className={styles.beatBody}>
              <textarea
                className={`${styles.fieldTextarea} ${styles.small}`}
                value={beatSheet[sec.key]}
                onChange={(e) => setBeatAndSave((b) => ({ ...b, [sec.key]: e.target.value }))}
                placeholder={sec.hint}
              />
            </div>
          </div>
        ))}

        {/* Breakdown — special: array of {bullet, why} */}
        <div className={styles.beatSection}>
          <div className={styles.beatHeader}>
            <div>
              <div className={styles.beatTitle}>Breakdown</div>
              <div className={styles.beatHint}>3 to 5 bullets explaining what&apos;s happening and why.</div>
            </div>
          </div>
          <div className={styles.beatBody}>
            {beatSheet.breakdown.map((item, idx) => (
              <div className={styles.breakdownItem} key={idx}>
                <div className={styles.breakdownNum}>{idx + 1}</div>
                <div className={styles.breakdownFields}>
                  <label>Bullet</label>
                  <input
                    type="text"
                    value={item.bullet}
                    onChange={(e) =>
                      setBeatAndSave((b) => ({
                        ...b,
                        breakdown: b.breakdown.map((br, i) => (i === idx ? { ...br, bullet: e.target.value } : br)),
                      }))
                    }
                    placeholder="What's happening in this beat."
                  />
                  <label>Why does this work?</label>
                  <textarea
                    value={item.why}
                    onChange={(e) =>
                      setBeatAndSave((b) => ({
                        ...b,
                        breakdown: b.breakdown.map((br, i) => (i === idx ? { ...br, why: e.target.value } : br)),
                      }))
                    }
                    placeholder="The reason this works, not just what it is."
                  />
                  {beatSheet.breakdown.length > 1 ? (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnTiny} ${styles.btnGhost}`}
                      onClick={() =>
                        setBeatAndSave((b) => ({
                          ...b,
                          breakdown: b.breakdown.filter((_, i) => i !== idx),
                        }))
                      }
                    >Remove</button>
                  ) : null}
                </div>
              </div>
            ))}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnTiny} ${styles.btnGhost}`}
              onClick={() =>
                setBeatAndSave((b) => ({ ...b, breakdown: [...b.breakdown, { bullet: "", why: "" }] }))
              }
            >+ Add bullet</button>
          </div>
        </div>

        {/* Terms */}
        <div className={styles.beatSection}>
          <div className={styles.beatHeader}>
            <div>
              <div className={styles.beatTitle}>Terms to define</div>
              <div className={styles.beatHint}>Every Fortnite word a beginner might not know. Required.</div>
            </div>
          </div>
          <div className={styles.beatBody}>
            {terms.map((t, idx) => (
              <div className={styles.termRow} key={idx}>
                <input
                  type="text"
                  placeholder="Term (e.g. tunneling)"
                  value={t.word}
                  onChange={(e) =>
                    setTermsAndSave((arr) => arr.map((it, i) => (i === idx ? { ...it, word: e.target.value } : it)))
                  }
                  maxLength={60}
                />
                <textarea
                  placeholder="Beginner-friendly definition, one line."
                  value={t.definition}
                  onChange={(e) =>
                    setTermsAndSave((arr) => arr.map((it, i) => (i === idx ? { ...it, definition: e.target.value } : it)))
                  }
                />
                {terms.length > 1 ? (
                  <button
                    type="button"
                    className={styles.xBtn}
                    onClick={() => setTermsAndSave((arr) => arr.filter((_, i) => i !== idx))}
                    aria-label="Remove"
                  >×</button>
                ) : <span />}
              </div>
            ))}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnTiny} ${styles.btnGhost}`}
              onClick={() => setTermsAndSave((arr) => [...arr, { word: "", definition: "" }])}
            >+ Add term</button>
          </div>
        </div>

        <div className={styles.btnRowSpread}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => goToStep(4)}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!canAdvance}
            onClick={() => goToStep(6)}
          >
            Lock it in
          </button>
        </div>
        {!canAdvance ? (
          <p className={styles.fieldHint}>
            Every section needs content, the breakdown needs at least one bullet, and you need at least one term defined.
          </p>
        ) : null}
      </section>
    );
  }

  function renderStep6() {
    const c = planner.reviewChecks;
    const canAdvance = stepComplete(6);
    const minutes = readMinutes(beatSheet, terms);
    const overTime = minutes > 5;
    const checkLabels = {
      oneIdea: "Clarity of the hook",
      definitions: "Accuracy of the skills",
      why: "Logical flow",
      pacing: "Beginner-friendly",
    } as const;
    const matches = videoUrl.trim() ? "Lesson matches the gameplay clip" : "";

    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Step 6 of 7</div>
        <h2 className={styles.cardTitle}>Look it over before you record.</h2>
        <p className={styles.cardHint}>
          Check each off as you confirm. No AI here — you decide.
        </p>

        <div className={styles.pacingDisplay}>
          {minutes.toFixed(1)} min <span className={styles.pacingLabel}>estimated talk time</span>
        </div>
        <p className={styles.fieldHint}>
          {overTime
            ? "That's a long one. Consider trimming the bullets — five minutes is usually the ceiling for a focused lesson."
            : "Pulled from your bullets. Calibration tunes after a few real recordings."}
        </p>

        {(Object.entries(checkLabels) as Array<[keyof typeof checkLabels, string]>).map(([k, label]) => (
          <label className={styles.checkRow} key={k}>
            <input
              type="checkbox"
              checked={c[k]}
              onChange={(e) =>
                setPlannerAndSave((p) => ({
                  ...p,
                  reviewChecks: { ...p.reviewChecks, [k]: e.target.checked },
                }))
              }
            />
            <span>{label}</span>
          </label>
        ))}
        {matches ? <p className={styles.fieldHint}>{matches}</p> : null}

        <div className={styles.btnRowSpread}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => goToStep(5)}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!canAdvance}
            onClick={() => goToStep(7)}
          >
            I&apos;m ready to record
          </button>
        </div>
      </section>
    );
  }

  function renderStep7() {
    const canPublish = stepComplete(7);
    const embedUrl = videoEmbedUrl(videoUrl);

    return (
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Step 7 of 7</div>
        <h2 className={styles.cardTitle}>Re-record + publish</h2>
        <p className={styles.cardHint}>
          Record the video using your beat sheet (visible below for reference). Paste the URL. Fill the parent-facing fields. Publish when ready.
        </p>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Video URL</label>
          <input
            type="url"
            className={styles.fieldInput}
            placeholder="https://youtube.com/watch?v=... or https://vimeo.com/... or https://www.loom.com/share/..."
            value={videoUrl}
            onChange={(e) => {
              setVideoUrl(e.target.value);
              queueSave({ video_url: e.target.value.trim() || null });
            }}
          />
          <span className={styles.fieldHint}>
            Upload your video to YouTube (unlisted), Vimeo, or Loom and paste the share URL.
          </span>
        </div>
        {embedUrl ? (
          <div className={styles.videoPreview}>
            <iframe
              src={embedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              title="Lesson preview"
            />
          </div>
        ) : videoUrl.trim() ? (
          <p className={styles.fieldHint}>
            URL saved. Embed preview not available for this source; it&apos;ll open in a new tab from the lesson viewer.
          </p>
        ) : null}

        <h3 className={styles.subhead}>Parent-facing details</h3>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Fortnite term (kid-facing label)</label>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder="e.g. Diagonal pressure"
            value={fortniteLabel}
            onChange={(e) => {
              setFortniteLabel(e.target.value);
              queueSave({ fortnite_label: e.target.value });
            }}
          />
        </div>
        {/* AI helper drafts the parent_label + parent_skill_description
            pair from the Fortnite term. Same Anthropic endpoint as the
            old lesson form — Tim edits whatever lands. */}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnAi}`}
          disabled={(aiState.busy && aiState.kind === "parent_translation") || !fortniteLabel.trim()}
          onClick={async () => {
            const sug = (await askAi("parent_translation", {
              fortnite_label: fortniteLabel.trim(),
              topic: topic || undefined,
              difficulty: difficultyLevel || undefined,
            })) as
              | { parent_label?: string; parent_skill_description?: string }
              | null;
            if (!sug) return;
            if (sug.parent_label) {
              setParentLabel(sug.parent_label);
              queueSave({ parent_label: sug.parent_label });
            }
            if (sug.parent_skill_description) {
              setParentSkillDescription(sug.parent_skill_description);
              queueSave({ parent_skill_description: sug.parent_skill_description });
            }
          }}
        >
          {aiState.busy && aiState.kind === "parent_translation"
            ? "Drafting parent translation..."
            : "✨ Draft parent label + description"}
        </button>
        {aiState.error && aiState.kind === "parent_translation" ? (
          <p className={styles.aiError}>AI call failed ({aiState.error}). Fill the fields manually.</p>
        ) : !fortniteLabel.trim() ? (
          <p className={styles.fieldHint}>Type a Fortnite term above to enable the AI helper.</p>
        ) : null}
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Parent label (real-world skill name)</label>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder="e.g. Staying calm when a fight gets fast"
            value={parentLabel}
            onChange={(e) => {
              setParentLabel(e.target.value);
              queueSave({ parent_label: e.target.value });
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Parent skill description (one sentence)</label>
          <textarea
            className={`${styles.fieldTextarea} ${styles.small}`}
            placeholder="Helps your kid keep their head when someone's pushing them, and make a plan instead of panicking."
            value={parentSkillDescription}
            onChange={(e) => {
              setParentSkillDescription(e.target.value);
              queueSave({ parent_skill_description: e.target.value });
            }}
          />
        </div>
        <div className={styles.fieldGrid3}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Topic</label>
            <select
              className={styles.fieldSelect}
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                queueSave({ topic: e.target.value || null });
              }}
            >
              <option value="">Choose...</option>
              {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Difficulty</label>
            <select
              className={styles.fieldSelect}
              value={difficultyLevel}
              onChange={(e) => {
                setDifficultyLevel(e.target.value);
                queueSave({ difficulty_level: e.target.value || null });
              }}
            >
              <option value="">Choose...</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Duration (min)</label>
            <input
              type="number"
              className={styles.fieldInput}
              min={1}
              max={120}
              value={durationMinutes}
              onChange={(e) => {
                setDurationMinutes(e.target.value);
                const n = parseInt(e.target.value, 10);
                queueSave({ duration_minutes: Number.isFinite(n) ? n : null });
              }}
            />
          </div>
        </div>

        <div className={styles.btnRowSpread}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => goToStep(6)}>
            Back to review
          </button>
          <div className={styles.btnRow}>
            {isPublished ? (
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={unpublish}>
                Unpublish
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={!canPublish}
              onClick={publish}
            >
              {isPublished ? "Save changes" : "Publish lesson"}
            </button>
          </div>
        </div>
        {!canPublish ? (
          <p className={styles.fieldHint}>
            All fields above need values to publish. Video URL, Fortnite term, parent label, parent description, topic, difficulty, duration.
          </p>
        ) : null}

        {/* Beat sheet preview at the bottom for reference during recording */}
        <div className={styles.outlineHeader} style={{ marginTop: 32 }}>
          <div>
            <h3 className={styles.subhead} style={{ margin: 0 }}>Beat sheet (reference while recording)</h3>
            <p className={styles.fieldHint} style={{ margin: "4px 0 0" }}>
              Saved with this lesson. Reopen any time from the library.
            </p>
          </div>
          <CopyOutlineButton beat={beatSheet} terms={terms} title={title} />
        </div>
        <BeatSheetPreview beat={beatSheet} terms={terms} />
      </section>
    );
  }

  // Step 7 pre-fill: the Fortnite term at Step 7 is just the name of
  // the skill Tim chose at Step 4. Don't make him retype it. Auto-fill
  // fortniteLabel from the narrow choice the first time it'd be
  // useful, BUT only if Tim hasn't typed anything of his own —
  // overwriting his edit silently would be worse than the empty state.
  useEffect(() => {
    if (fortniteLabel.trim()) return;
    const chosen = planner.identifyList.find((it) => it.id === planner.narrowChoice);
    if (chosen && chosen.name.trim()) {
      setFortniteLabel(chosen.name.trim());
      queueSave({ fortnite_label: chosen.name.trim() });
    }
  }, [planner.narrowChoice, planner.identifyList, fortniteLabel, queueSave]);

  // Flushes any pending save when unmounting — guarantees the last
  // keystroke lands even if the user navigates away fast.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const body = pendingRef.current;
        if (Object.keys(body).length > 0) {
          // Best-effort sync save via keepalive fetch so the request
          // survives navigation.
          try {
            navigator.sendBeacon?.(
              `/api/admin/lessons/${lessonId}`,
              new Blob([JSON.stringify(body)], { type: "application/json" }),
            );
          } catch {
            /* ignore */
          }
        }
      }
    };
  }, [lessonId]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function savingLabel(s: "idle" | "pending" | "saving" | "saved" | "error"): string {
  switch (s) {
    case "pending": return "Edited";
    case "saving": return "Saving...";
    case "saved": return "Saved";
    case "error": return "Save failed";
    case "idle": default: return "";
  }
}

function SpawnIndependentButton({
  lessonId,
  count,
  alreadySpawned,
  onSpawned,
}: {
  lessonId: string;
  count: number;
  alreadySpawned: boolean;
  onSpawned: (createdIds: string[]) => void;
}) {
  const [state, setState] = useState<"idle" | "spawning" | "done" | "error">(
    alreadySpawned ? "done" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return (
      <div className={styles.spawnDone}>
        ✓ {count} independent draft lesson{count === 1 ? "" : "s"} created. Find them in{" "}
        <a href="/admin/lessons?tab=drafts">/admin/lessons → Drafts</a>. Bundle
        them together later from the Bundles tab if they belong as a group.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        disabled={state === "spawning"}
        onClick={async () => {
          setState("spawning");
          setError(null);
          try {
            const res = await fetch(`/api/admin/lessons/${lessonId}/spawn-independent`, {
              method: "POST",
            });
            const body = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              created_ids?: string[];
              error?: string;
              detail?: string;
            };
            if (!res.ok || !body.ok) {
              setError(body.detail ?? body.error ?? "spawn_failed");
              setState("error");
              return;
            }
            onSpawned(body.created_ids ?? []);
            setState("done");
          } catch {
            setError("network");
            setState("error");
          }
        }}
      >
        {state === "spawning"
          ? "Spawning..."
          : `Spawn ${count} independent lesson${count === 1 ? "" : "s"}`}
      </button>
      {state === "error" ? (
        <p className={styles.aiError}>
          Spawn failed ({error}). You can retry or create each lesson manually from the library.
        </p>
      ) : null}
    </div>
  );
}

function SpawnSeriesButton({
  lessonId,
  itemCount,
  alreadySpawned,
}: {
  lessonId: string;
  itemCount: number;
  alreadySpawned: boolean;
}) {
  const [state, setState] = useState<"idle" | "spawning" | "done" | "error">(
    alreadySpawned ? "done" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState<number>(0);

  if (state === "done") {
    return (
      <div className={styles.spawnDone}>
        ✓ Series stubs are in your library. Open each from{" "}
        <a href="/admin/lessons">/admin/lessons</a> to plan it.
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        disabled={state === "spawning"}
        onClick={async () => {
          setState("spawning");
          setError(null);
          try {
            const res = await fetch(`/api/admin/lessons/${lessonId}/spawn-series`, {
              method: "POST",
            });
            const body = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              created_ids?: string[];
              error?: string;
              detail?: string;
            };
            if (!res.ok || !body.ok) {
              setError(body.detail ?? body.error ?? "spawn_failed");
              setState("error");
              return;
            }
            setCreatedCount(body.created_ids?.length ?? 0);
            setState("done");
          } catch {
            setError("network");
            setState("error");
          }
        }}
      >
        {state === "spawning"
          ? "Spawning..."
          : `Spawn ${itemCount} series stubs`}
      </button>
      {state === "error" ? (
        <p className={styles.aiError}>
          Spawn failed ({error}). The capstone plan is still saved here — you can retry or build each lesson manually from the library.
        </p>
      ) : null}
      {createdCount > 0 ? (
        <p className={styles.fieldHint}>{createdCount} stub lesson(s) created.</p>
      ) : null}
    </div>
  );
}

function buildOutlineText(title: string, beat: BeatSheet, terms: Term[]): string {
  const lines: string[] = [];
  lines.push(title || "Untitled lesson");
  lines.push("=".repeat(Math.max(20, (title || "Untitled lesson").length)));
  lines.push("");
  const validTerms = terms.filter((t) => t.word.trim() && t.definition.trim());
  if (validTerms.length > 0) {
    lines.push("GLOSSARY");
    for (const t of validTerms) lines.push(`  ${t.word.trim()}. ${t.definition.trim()}`);
    lines.push("");
  }
  const push = (heading: string, body: string) => {
    if (!body || !body.trim()) return;
    lines.push(heading.toUpperCase());
    lines.push(body.trim());
    lines.push("");
  };
  push("Hook", beat.hook);
  push("Goal", beat.goal);
  push("Demonstration", beat.demonstration);
  const breakdown = beat.breakdown.filter((b) => b.bullet.trim());
  if (breakdown.length > 0) {
    lines.push("BREAKDOWN");
    breakdown.forEach((b, i) => {
      lines.push(`  ${i + 1}. ${b.bullet.trim()}`);
      if (b.why.trim()) lines.push(`     Why: ${b.why.trim()}`);
    });
    lines.push("");
  }
  push("Common mistake", beat.commonMistake);
  push("Practice setup", beat.practiceSetup);
  push("Summary", beat.summary);
  push("Outro", beat.outro);
  return lines.join("\n").trimEnd() + "\n";
}

function CopyOutlineButton({
  beat,
  terms,
  title,
}: {
  beat: BeatSheet;
  terms: Term[];
  title: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  return (
    <button
      type="button"
      className={`${styles.btn} ${styles.btnGhost}`}
      onClick={async () => {
        const text = buildOutlineText(title, beat, terms);
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
          setTimeout(() => setState("idle"), 1800);
        } catch {
          setState("error");
          setTimeout(() => setState("idle"), 2400);
        }
      }}
    >
      {state === "copied" ? "✓ Copied" : state === "error" ? "Copy blocked. Select manually." : "Copy outline"}
    </button>
  );
}

function BeatSheetPreview({ beat, terms }: { beat: BeatSheet; terms: Term[] }) {
  const validTerms = terms.filter((t) => t.word.trim() && t.definition.trim());
  const sec = (title: string, body: string) => {
    if (!body || !body.trim()) return null;
    return (
      <div className={styles.previewSection} key={title}>
        <div className={styles.previewEyebrow}>{title}</div>
        <p>{body}</p>
      </div>
    );
  };
  return (
    <div className={styles.previewWrap}>
      {validTerms.length > 0 ? (
        <div className={styles.previewGlossary}>
          <h4>Glossary</h4>
          <ul>
            {validTerms.map((t) => (
              <li key={t.word}><strong>{t.word}.</strong> {t.definition}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {sec("Hook", beat.hook)}
      {sec("Goal", beat.goal)}
      {sec("Demonstration", beat.demonstration)}
      {beat.breakdown.filter((b) => b.bullet.trim()).length > 0 ? (
        <div className={styles.previewSection}>
          <div className={styles.previewEyebrow}>Breakdown</div>
          <ul>
            {beat.breakdown.filter((b) => b.bullet.trim()).map((b, i) => (
              <li key={i}>
                {b.bullet}
                {b.why.trim() ? <span className={styles.previewWhy}>{b.why}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sec("Common mistake", beat.commonMistake)}
      {sec("Practice setup", beat.practiceSetup)}
      {sec("Summary", beat.summary)}
      {sec("Outro", beat.outro)}
    </div>
  );
}
