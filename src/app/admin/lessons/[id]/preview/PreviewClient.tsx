"use client";

// Client wrapper around LessonView for the admin preview page. Adds:
//   - Kid / Parent view toggle (lets Tim see both audiences)
//   - Top bar with "Back to library" + "Edit lesson"
//   - "Coach preview" eyebrow so Tim doesn't confuse this with the
//     student view if he forgets which surface he's on

import { useState } from "react";
import Link from "next/link";
import LessonView, { type LessonForView, type ViewerMode } from "./LessonView";
import styles from "./preview.module.css";

export default function PreviewClient({ lesson }: { lesson: LessonForView }) {
  const [mode, setMode] = useState<ViewerMode>("kid");
  return (
    <div className={styles.shell}>
      <header className={styles.previewBar}>
        <div className={styles.previewBarLeft}>
          <Link href="/admin/lessons" className={styles.backLink}>
            ← Library
          </Link>
          <span className={styles.coachPreviewBadge}>Coach preview</span>
        </div>
        <div className={styles.viewToggle} role="tablist" aria-label="Audience">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "kid"}
            className={`${styles.viewToggleBtn} ${mode === "kid" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => setMode("kid")}
          >
            As kid
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "parent"}
            className={`${styles.viewToggleBtn} ${mode === "parent" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => setMode("parent")}
          >
            As parent
          </button>
        </div>
        <Link href={`/admin/lessons/${lesson.id}/edit`} className={styles.editLink}>
          Edit lesson
        </Link>
      </header>
      <main className={styles.previewMain} data-mode={mode}>
        <LessonView lesson={lesson} mode={mode} />
      </main>
    </div>
  );
}
