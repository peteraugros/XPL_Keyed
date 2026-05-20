"use client";

// Lesson authoring form. Three sections:
//   1. Metadata (title, fortnite_label, parent_label,
//      parent_skill_description, topic, difficulty, duration).
//   2. Slides — a dynamic list. Each slide row has: PNG file picker,
//      MP3 file picker (optional for MVP), speaker notes textarea.
//      Add / remove buttons per slide.
//   3. Parent talking points — 5 categorized textareas (informed_observer,
//      co_conspirator, cultural_literacy, good_question, strategic_note).
//
// Submit: builds a multipart FormData payload with metadata fields,
// slide files keyed by index, and ptp_<category> entries. POSTs to
// /api/admin/lessons.
//
// Files are sent server-side and uploaded to Supabase Storage from the
// route handler. Larger files in production will need client-side
// signed-URL upload — flagged in CLAUDE.md as the Vercel 4.5MB limit.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./form.module.css";

type Slide = {
  image: File | null;
  audio: File | null;
  notes: string;
};

const TOPICS = [
  { value: "building", label: "Building" },
  { value: "editing", label: "Editing" },
  { value: "aim", label: "Aim" },
  { value: "game_sense", label: "Game sense" },
  { value: "mental", label: "Mental" },
  { value: "tournament_prep", label: "Tournament prep" },
];

const DIFFICULTIES = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "unreal", label: "Unreal" },
];

const PTP_CATEGORIES: { value: string; label: string; hint: string }[] = [
  {
    value: "informed_observer",
    label: "Informed observer",
    hint: "What parent can notice during the kid's gameplay this week. Specific behavior to look for.",
  },
  {
    value: "co_conspirator",
    label: "Co conspirator",
    hint: "A line from Tim the parent delivers. Frames Tim as in on the joke with parent.",
  },
  {
    value: "cultural_literacy",
    label: "Cultural literacy",
    hint: "One Fortnite term parent can use that sounds authentic, not forced.",
  },
  {
    value: "good_question",
    label: "Good question",
    hint: "A question parent asks (does not perform) that signals real curiosity.",
  },
  {
    value: "strategic_note",
    label: "Strategic note",
    hint: "An actually impressive observation about strategy at the kid's level.",
  },
];

function emptySlide(): Slide {
  return { image: null, audio: null, notes: "" };
}

export default function LessonForm() {
  const router = useRouter();

  // Metadata
  const [title, setTitle] = useState("");
  const [fortniteLabel, setFortniteLabel] = useState("");
  const [parentLabel, setParentLabel] = useState("");
  const [parentSkillDescription, setParentSkillDescription] = useState("");
  const [topic, setTopic] = useState<string>("game_sense");
  const [difficulty, setDifficulty] = useState<string>("intermediate");
  const [durationMinutes, setDurationMinutes] = useState<number>(20);
  const [isPublished, setIsPublished] = useState<boolean>(false);

  // Slides
  const [slides, setSlides] = useState<Slide[]>([emptySlide()]);

  // Parent talking points (one text per category)
  const [ptp, setPtp] = useState<Record<string, string>>(
    Object.fromEntries(PTP_CATEGORIES.map((c) => [c.value, ""])),
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI suggest state: which kind is being generated right now (so we
  // can disable + label the right button), and any error from the
  // most recent call. Output lands directly in the form fields.
  const [aiBusy, setAiBusy] = useState<null | "parent_translation" | "talking_points">(null);
  const [aiError, setAiError] = useState<string | null>(null);

  async function runAiSuggest(kind: "parent_translation" | "talking_points") {
    setAiError(null);
    if (!fortniteLabel.trim()) {
      setAiError("Type the Fortnite term (kid facing title) first.");
      return;
    }
    setAiBusy(kind);
    try {
      const payload: Record<string, string> = {
        kind,
        fortnite_label: fortniteLabel.trim(),
        topic,
        difficulty,
      };
      if (kind === "talking_points") {
        if (parentLabel.trim()) payload.parent_label = parentLabel.trim();
        if (parentSkillDescription.trim())
          payload.parent_skill_description = parentSkillDescription.trim();
      }
      const res = await fetch("/api/admin/lessons/ai-suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        suggestion?: Record<string, string>;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.suggestion) {
        setAiError(body.error ?? "AI suggestion failed.");
        setAiBusy(null);
        return;
      }
      const s = body.suggestion;
      if (kind === "parent_translation") {
        if (typeof s.parent_label === "string") setParentLabel(s.parent_label);
        if (typeof s.parent_skill_description === "string")
          setParentSkillDescription(s.parent_skill_description);
      } else {
        setPtp((prev) => {
          const next = { ...prev };
          for (const c of PTP_CATEGORIES) {
            if (typeof s[c.value] === "string") next[c.value] = s[c.value];
          }
          return next;
        });
      }
      setAiBusy(null);
    } catch {
      setAiError("Could not reach the AI service.");
      setAiBusy(null);
    }
  }

  function updateSlide(i: number, patch: Partial<Slide>) {
    setSlides((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addSlide() {
    setSlides((prev) => [...prev, emptySlide()]);
  }
  function removeSlide(i: number) {
    setSlides((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function canSubmit(): boolean {
    if (
      !title.trim() ||
      !fortniteLabel.trim() ||
      !parentLabel.trim() ||
      !parentSkillDescription.trim() ||
      !durationMinutes
    )
      return false;
    if (slides.length < 1) return false;
    if (slides.some((s) => !s.image)) return false;
    for (const c of PTP_CATEGORIES) {
      if (!(ptp[c.value] ?? "").trim()) return false;
    }
    return true;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit()) {
      setError("Fill in every field, give each slide an image, and write each parent talking point.");
      return;
    }
    setSubmitting(true);

    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("fortnite_label", fortniteLabel.trim());
    fd.set("parent_label", parentLabel.trim());
    fd.set("parent_skill_description", parentSkillDescription.trim());
    fd.set("topic", topic);
    fd.set("difficulty_level", difficulty);
    fd.set("duration_minutes", String(durationMinutes));
    fd.set("is_published", isPublished ? "true" : "false");
    fd.set("slide_count", String(slides.length));
    slides.forEach((s, i) => {
      if (s.image) fd.set(`slide_${i}_image`, s.image);
      if (s.audio) fd.set(`slide_${i}_audio`, s.audio);
      fd.set(`slide_${i}_notes`, s.notes);
    });
    for (const c of PTP_CATEGORIES) {
      fd.set(`ptp_${c.value}`, ptp[c.value] ?? "");
    }

    try {
      const res = await fetch("/api/admin/lessons", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        lesson_id?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Save failed.");
        setSubmitting(false);
        return;
      }
      (router.replace as (u: string) => void)("/admin/lessons");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <h1 className={styles.heroTitle}>Author a lesson</h1>

      {/* Metadata */}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Lesson metadata</legend>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Internal title (Tim facing)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={styles.input}
            maxLength={160}
            placeholder="e.g. Tunneling 101"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Kid facing title (Fortnite term)</span>
          <input
            type="text"
            value={fortniteLabel}
            onChange={(e) => setFortniteLabel(e.target.value)}
            className={styles.input}
            maxLength={120}
            placeholder="e.g. Tunneling"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Parent facing label (real world skill)</span>
          <input
            type="text"
            value={parentLabel}
            onChange={(e) => setParentLabel(e.target.value)}
            className={styles.input}
            maxLength={180}
            placeholder="e.g. Defensive building under pressure"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Parent skill description (email blurb)</span>
          <textarea
            value={parentSkillDescription}
            onChange={(e) => setParentSkillDescription(e.target.value)}
            className={styles.textarea}
            rows={2}
            maxLength={500}
            placeholder="e.g. Trains spatial planning and multi step execution under pressure."
          />
        </label>

        <div className={styles.aiRow}>
          <button
            type="button"
            onClick={() => runAiSuggest("parent_translation")}
            disabled={aiBusy !== null || !fortniteLabel.trim()}
            className={styles.aiBtn}
          >
            {aiBusy === "parent_translation"
              ? "Drafting..."
              : "✨ Suggest parent label + description"}
          </button>
          <span className={styles.aiHint}>
            Fills the two fields above from the Fortnite label. Always editable.
          </span>
        </div>
        {aiError && aiBusy === null ? (
          <div className={styles.aiError}>{aiError}</div>
        ) : null}

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Topic</span>
            <select value={topic} onChange={(e) => setTopic(e.target.value)} className={styles.input}>
              {TOPICS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Difficulty</span>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className={styles.input}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Duration (minutes)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className={styles.input}
            />
          </label>
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
          />
          Publish immediately (uncheck to save as draft)
        </label>
      </fieldset>

      {/* Slides */}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Slides</legend>
        <p className={styles.hint}>
          Export slides from Google Slides as PNG. Record per slide audio in
          QuickTime as MP3. Audio is optional but every slide needs an image.
        </p>
        {slides.map((s, i) => (
          <div key={i} className={styles.slideBlock}>
            <div className={styles.slideHeader}>
              <span className={styles.slideLabel}>Slide {i + 1}</span>
              {slides.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeSlide(i)}
                  className={styles.removeBtn}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Slide image (PNG)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => updateSlide(i, { image: e.target.files?.[0] ?? null })}
                className={styles.fileInput}
              />
              {s.image ? (
                <span className={styles.filename}>{s.image.name} · {(s.image.size / 1024).toFixed(0)} KB</span>
              ) : null}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Audio (MP3, optional)</span>
              <input
                type="file"
                accept="audio/mpeg,audio/mp4,audio/wav,audio/x-m4a"
                onChange={(e) => updateSlide(i, { audio: e.target.files?.[0] ?? null })}
                className={styles.fileInput}
              />
              {s.audio ? (
                <span className={styles.filename}>{s.audio.name} · {(s.audio.size / 1024).toFixed(0)} KB</span>
              ) : null}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Speaker notes (Tim facing)</span>
              <textarea
                value={s.notes}
                onChange={(e) => updateSlide(i, { notes: e.target.value })}
                className={styles.textarea}
                rows={2}
                maxLength={1000}
                placeholder="What Tim says or remembers about this slide."
              />
            </label>
          </div>
        ))}
        <button type="button" onClick={addSlide} className={styles.addBtn}>
          + Add another slide
        </button>
      </fieldset>

      {/* Parent talking points */}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Parent talking points</legend>
        <p className={styles.hint}>
          One per category. These ship in every parent email for this lesson.
          Strategic moat: this is what differentiates XPL Keyed from
          generic coaching.
        </p>
        <div className={styles.aiRow}>
          <button
            type="button"
            onClick={() => runAiSuggest("talking_points")}
            disabled={aiBusy !== null || !fortniteLabel.trim()}
            className={styles.aiBtn}
          >
            {aiBusy === "talking_points"
              ? "Drafting..."
              : "✨ Suggest all 5 talking points"}
          </button>
          <span className={styles.aiHint}>
            Drafts one line per category from the Fortnite label + topic. Edit
            each in your voice before saving.
          </span>
        </div>
        {aiError ? <div className={styles.aiError}>{aiError}</div> : null}
        {PTP_CATEGORIES.map((c) => (
          <label key={c.value} className={styles.field}>
            <span className={styles.fieldLabel}>{c.label}</span>
            <span className={styles.fieldHint}>{c.hint}</span>
            <textarea
              value={ptp[c.value] ?? ""}
              onChange={(e) => setPtp((prev) => ({ ...prev, [c.value]: e.target.value }))}
              className={styles.textarea}
              rows={2}
              maxLength={500}
            />
          </label>
        ))}
      </fieldset>

      {error ? <div className={styles.alert}>{error}</div> : null}

      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={!canSubmit() || submitting}
        >
          {submitting ? "Saving and uploading..." : "Save lesson"}
        </button>
      </div>
    </form>
  );
}
