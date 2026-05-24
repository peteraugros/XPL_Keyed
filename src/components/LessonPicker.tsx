"use client";

// LessonPicker
// ------------
// One shared lesson-selection component used wherever Tim assigns a
// lesson — swap-lesson modal, bundle membership, future single-session
// pick, etc. Search-first UX with lightweight filter chips as
// optional refinement (per Peter's read on how Tim actually thinks
// while assigning lessons).
//
// Caller passes the full lesson list + optional context (player id
// for "already taught" badges, current selection, ids to exclude).
// Picker handles search + filter state internally + calls back with
// the chosen lesson id.

import { useMemo, useState } from "react";
import { fuzzyFilter, type SearchableLesson } from "@/lib/lessons/fuzzy";
import styles from "./LessonPicker.module.css";

export type PickerLesson = {
  id: string;
  title: string;
  fortnite_label?: string | null;
  parent_label?: string | null;
  parent_skill_description?: string | null;
  topic?: string | null;
  difficulty_level?: string | null;
  duration_minutes?: number | null;
  is_published?: boolean;
  video_url?: string | null;
  bundle_id?: string | null;
  bundle_title?: string | null;
  series_id?: string | null;
  series_position?: number | null;
  already_done?: boolean;
  updated_at?: string | null;
};

export type LessonPickerProps = {
  lessons: PickerLesson[];
  onPick: (lessonId: string) => void;
  submittingId?: string | null;
  // Optional caller-supplied scoping.
  excludeIds?: string[];                 // hide entirely
  currentSelectionId?: string | null;    // highlight as selected
  // Visual-only — the picker will surface these contextually.
  emptyMessage?: string;
};

const TOPICS = [
  "building",
  "editing",
  "aim",
  "game_sense",
  "mental",
  "tournament_prep",
] as const;
const DIFFICULTIES = ["beginner", "intermediate", "advanced", "unreal"] as const;

type PublishFilter = "all" | "published" | "draft";
type BundleFilter = "all" | "bundled" | "unbundled";
type AlreadyFilter = "all" | "fresh" | "done";

export default function LessonPicker({
  lessons,
  onPick,
  submittingId,
  excludeIds,
  currentSelectionId,
  emptyMessage,
}: LessonPickerProps) {
  const [query, setQuery] = useState("");
  const [publishFilter, setPublishFilter] = useState<PublishFilter>("all");
  const [bundleFilter, setBundleFilter] = useState<BundleFilter>("all");
  const [alreadyFilter, setAlreadyFilter] = useState<AlreadyFilter>("all");
  const [topicFilter, setTopicFilter] = useState<string>("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("");
  const [sortRecent, setSortRecent] = useState<boolean>(false);

  const excludeSet = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  const filtered = useMemo(() => {
    let pool = lessons.filter((l) => !excludeSet.has(l.id));

    if (publishFilter === "published") pool = pool.filter((l) => !!l.is_published);
    if (publishFilter === "draft") pool = pool.filter((l) => !l.is_published);
    if (bundleFilter === "bundled") pool = pool.filter((l) => !!l.bundle_id);
    if (bundleFilter === "unbundled") pool = pool.filter((l) => !l.bundle_id);
    if (alreadyFilter === "fresh") pool = pool.filter((l) => !l.already_done);
    if (alreadyFilter === "done") pool = pool.filter((l) => !!l.already_done);
    if (topicFilter) pool = pool.filter((l) => l.topic === topicFilter);
    if (difficultyFilter) pool = pool.filter((l) => l.difficulty_level === difficultyFilter);

    // Map to fuzzy search shape: primary = high-weight fields, secondary = the rest.
    const searchables: Array<SearchableLesson & { _src: PickerLesson }> = pool.map((l) => ({
      id: l.id,
      primary: [l.title, l.fortnite_label, l.parent_label].filter(Boolean).join(" "),
      secondary: [l.parent_skill_description, l.topic, l.difficulty_level].filter(Boolean).join(" "),
      _src: l,
    }));

    const matched = fuzzyFilter(query, searchables);
    let out = matched.map((m) => m.lesson._src);

    // Default sort: when a query is active, fuzzyFilter already sorted
    // by score. With no query, prefer recent if the toggle is on,
    // otherwise alphabetical by title.
    if (!query.trim()) {
      if (sortRecent) {
        out.sort((a, b) => {
          const at = a.updated_at ? Date.parse(a.updated_at) : 0;
          const bt = b.updated_at ? Date.parse(b.updated_at) : 0;
          return bt - at;
        });
      } else {
        out.sort((a, b) => a.title.localeCompare(b.title));
      }
    }

    return out;
  }, [
    lessons,
    excludeSet,
    publishFilter,
    bundleFilter,
    alreadyFilter,
    topicFilter,
    difficultyFilter,
    query,
    sortRecent,
  ]);

  const totalBeforeFilter = lessons.length - excludeSet.size;
  const someFilterActive =
    publishFilter !== "all" ||
    bundleFilter !== "all" ||
    alreadyFilter !== "all" ||
    !!topicFilter ||
    !!difficultyFilter ||
    sortRecent;

  function clearFilters() {
    setPublishFilter("all");
    setBundleFilter("all");
    setAlreadyFilter("all");
    setTopicFilter("");
    setDifficultyFilter("");
    setSortRecent(false);
  }

  return (
    <div className={styles.picker}>
      <input
        type="search"
        className={styles.searchInput}
        placeholder="Search lessons. Title, topic, partial words all work."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <div className={styles.filterRow} role="group" aria-label="Filters">
        <SelectChip
          label="Topic"
          value={topicFilter}
          onChange={setTopicFilter}
          options={[{ value: "", label: "Any topic" }, ...TOPICS.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))]}
        />
        <SelectChip
          label="Difficulty"
          value={difficultyFilter}
          onChange={setDifficultyFilter}
          options={[{ value: "", label: "Any difficulty" }, ...DIFFICULTIES.map((d) => ({ value: d, label: d }))]}
        />
        <ToggleChip
          label="Published only"
          active={publishFilter === "published"}
          onClick={() =>
            setPublishFilter((p) => (p === "published" ? "all" : "published"))
          }
        />
        <ToggleChip
          label="Drafts only"
          active={publishFilter === "draft"}
          onClick={() => setPublishFilter((p) => (p === "draft" ? "all" : "draft"))}
        />
        <ToggleChip
          label="Unbundled"
          active={bundleFilter === "unbundled"}
          onClick={() => setBundleFilter((p) => (p === "unbundled" ? "all" : "unbundled"))}
        />
        {lessons.some((l) => l.already_done !== undefined) ? (
          <ToggleChip
            label="Not yet taught"
            active={alreadyFilter === "fresh"}
            onClick={() => setAlreadyFilter((p) => (p === "fresh" ? "all" : "fresh"))}
          />
        ) : null}
        <ToggleChip
          label="Recent first"
          active={sortRecent}
          onClick={() => setSortRecent((s) => !s)}
        />
        {someFilterActive ? (
          <button type="button" className={styles.clearBtn} onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      <div className={styles.resultMeta}>
        {filtered.length} of {totalBeforeFilter} lesson{totalBeforeFilter === 1 ? "" : "s"}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {emptyMessage ?? "No lessons match. Try fewer keywords or clear filters."}
        </div>
      ) : (
        <ul className={styles.resultList}>
          {filtered.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={`${styles.resultRow} ${currentSelectionId === l.id ? styles.resultRowSelected : ""}`}
                onClick={() => onPick(l.id)}
                disabled={submittingId === l.id}
              >
                <div className={styles.resultMain}>
                  <div className={styles.resultTitle}>{l.title}</div>
                  {l.fortnite_label && l.fortnite_label !== l.title ? (
                    <div className={styles.resultSub}>{l.fortnite_label}</div>
                  ) : null}
                </div>
                <div className={styles.resultBadges}>
                  {l.is_published ? (
                    <span className={`${styles.badge} ${styles.badgePublished}`}>Published</span>
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeDraft}`}>Draft</span>
                  )}
                  {l.already_done ? (
                    <span className={`${styles.badge} ${styles.badgeDone}`}>Already taught</span>
                  ) : null}
                  {l.series_id ? (
                    l.series_id === l.id ? (
                      <span className={`${styles.badge} ${styles.badgeSeries}`}>Capstone</span>
                    ) : (
                      <span className={`${styles.badge} ${styles.badgeSeries}`}>
                        Part {l.series_position ?? "?"}
                      </span>
                    )
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeStandalone}`}>Standalone</span>
                  )}
                  {l.bundle_title ? (
                    <span className={`${styles.badge} ${styles.badgeBundle}`}>
                      {l.bundle_title}
                    </span>
                  ) : null}
                  {l.topic ? <span className={styles.badge}>{l.topic.replace(/_/g, " ")}</span> : null}
                  {l.difficulty_level ? <span className={styles.badge}>{l.difficulty_level}</span> : null}
                  {l.duration_minutes ? (
                    <span className={styles.badge}>{l.duration_minutes}m</span>
                  ) : null}
                </div>
                {submittingId === l.id ? (
                  <span className={styles.submittingHint}>Saving...</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.chip} ${active ? styles.chipActive : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SelectChip({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const active = !!value;
  return (
    <label className={`${styles.chipSelectWrap} ${active ? styles.chipActive : ""}`}>
      <span className={styles.chipSelectLabel}>{label}</span>
      <select
        className={styles.chipSelect}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
