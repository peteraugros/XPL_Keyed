"use client";

// Lesson edit form. Sister to /admin/lessons/new/LessonForm but text-only:
// metadata + speaker notes on existing slides + parent talking points.
// Media (slide images, audio) is NOT editable here.
//
// Submit: JSON PATCH to /api/admin/lessons/[id].

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../new/form.module.css";

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
    hint: "What parent can notice during the kid's gameplay this week.",
  },
  {
    value: "co_conspirator",
    label: "Co conspirator",
    hint: "A line from Tim the parent delivers.",
  },
  {
    value: "cultural_literacy",
    label: "Cultural literacy",
    hint: "One Fortnite term parent can use that sounds authentic.",
  },
  {
    value: "good_question",
    label: "Good question",
    hint: "A question parent asks that signals real curiosity.",
  },
  {
    value: "strategic_note",
    label: "Strategic note",
    hint: "An impressive observation about strategy at the kid's level.",
  },
];

type Slide = {
  position?: number;
  image_url?: string | null;
  audio_url?: string | null;
  speaker_notes?: string;
};
type Ptp = { category: string; text: string };

export default function LessonEditForm({
  lessonId,
  initial,
}: {
  lessonId: string;
  initial: {
    title: string;
    fortnite_label: string;
    parent_label: string;
    parent_skill_description: string;
    topic: string;
    difficulty_level: string;
    duration_minutes: number;
    is_published: boolean;
    slides: Slide[];
    parent_talking_points: Ptp[];
  };
}) {
  const router = useRouter();

  const [title, setTitle] = useState(initial.title);
  const [fortniteLabel, setFortniteLabel] = useState(initial.fortnite_label);
  const [parentLabel, setParentLabel] = useState(initial.parent_label);
  const [parentSkillDescription, setParentSkillDescription] = useState(
    initial.parent_skill_description,
  );
  const [topic, setTopic] = useState<string>(initial.topic);
  const [difficulty, setDifficulty] = useState<string>(initial.difficulty_level);
  const [durationMinutes, setDurationMinutes] = useState<number>(
    initial.duration_minutes,
  );
  const [isPublished, setIsPublished] = useState<boolean>(initial.is_published);

  // Per-slide speaker notes (text only).
  const [slideNotes, setSlideNotes] = useState<string[]>(
    initial.slides.length > 0
      ? initial.slides.map((s) => s.speaker_notes ?? "")
      : [""],
  );

  // PTP by category, seeded from existing rows or empty.
  const ptpInitial: Record<string, string> = Object.fromEntries(
    PTP_CATEGORIES.map((c) => [c.value, ""]),
  );
  for (const row of initial.parent_talking_points) {
    if (row.category in ptpInitial) ptpInitial[row.category] = row.text;
  }
  const [ptp, setPtp] = useState<Record<string, string>>(ptpInitial);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        fortnite_label: fortniteLabel.trim(),
        parent_label: parentLabel.trim(),
        parent_skill_description: parentSkillDescription.trim(),
        topic,
        difficulty_level: difficulty,
        duration_minutes: durationMinutes,
        is_published: isPublished,
        slide_notes: slideNotes,
        parent_talking_points: PTP_CATEGORIES.map((c) => ({
          category: c.value,
          text: ptp[c.value] ?? "",
        })),
      };
      const res = await fetch(`/api/admin/lessons/${lessonId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const r = (await res.json().catch(() => ({}))) as { error?: string };
        setError(r.error ?? "Save failed.");
        setSubmitting(false);
        return;
      }
      setSaved(true);
      setSubmitting(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <h1 className={styles.heroTitle}>Edit lesson</h1>
      <p className={styles.hint}>
        Text fields only. Slide images and audio are NOT editable here. Re
        author a fresh lesson at /admin/lessons/new if you want new media.
      </p>

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
          />
        </label>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Topic</span>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className={styles.input}
            >
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
          Published (uncheck to hide from auto renew library)
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Speaker notes per slide</legend>
        <p className={styles.hint}>
          Tim facing only. Notes for what to say or remember during each slide.
        </p>
        {slideNotes.map((note, i) => (
          <div key={i} className={styles.slideBlock}>
            <div className={styles.slideHeader}>
              <span className={styles.slideLabel}>Slide {i + 1}</span>
              {initial.slides[i]?.image_url ? (
                <a
                  href={initial.slides[i].image_url ?? "#"}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={styles.removeBtn}
                  style={{ background: "transparent", borderColor: "var(--border)", color: "var(--text-dim)" }}
                >
                  View image
                </a>
              ) : null}
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Speaker notes</span>
              <textarea
                value={note}
                onChange={(e) =>
                  setSlideNotes((prev) =>
                    prev.map((n, idx) => (idx === i ? e.target.value : n)),
                  )
                }
                className={styles.textarea}
                rows={2}
                maxLength={2000}
              />
            </label>
          </div>
        ))}
        {slideNotes.length === 0 ? (
          <p className={styles.hint}>
            No slides on this lesson yet. Re author at /admin/lessons/new to add slides.
          </p>
        ) : null}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Parent talking points</legend>
        {PTP_CATEGORIES.map((c) => (
          <label key={c.value} className={styles.field}>
            <span className={styles.fieldLabel}>{c.label}</span>
            <span className={styles.fieldHint}>{c.hint}</span>
            <textarea
              value={ptp[c.value] ?? ""}
              onChange={(e) =>
                setPtp((prev) => ({ ...prev, [c.value]: e.target.value }))
              }
              className={styles.textarea}
              rows={2}
              maxLength={500}
            />
          </label>
        ))}
      </fieldset>

      {error ? <div className={styles.alert}>{error}</div> : null}
      {saved ? <div className={styles.alert} style={{ background: "rgba(49,146,54,0.12)", color: "var(--uncommon)", borderColor: "rgba(49,146,54,0.55)" }}>Saved.</div> : null}

      <div className={styles.actions}>
        <button type="submit" className={styles.primaryBtn} disabled={submitting}>
          {submitting ? "Saving..." : "Save changes"}
        </button>
        <a href="/admin/lessons" className={styles.secondaryBtn ?? styles.removeBtn}>
          Back to library
        </a>
      </div>
    </form>
  );
}
