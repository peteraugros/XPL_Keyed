"use client";

// Three-dot kebab menu on each lesson row in /admin/lessons.
// Two actions:
//   - Edit: opens the planner at /admin/lessons/[id]/edit (same as the
//     inline "Open planner" link below the row; the menu gives Tim a
//     consistent affordance shape with Delete).
//   - Delete: calls DELETE /api/admin/lessons/[id]. Two-step inline
//     confirm (no browser confirm() dialog — feels jarring). If the
//     lesson is referenced by a curriculum_slot the endpoint returns
//     409 with a detail message; we surface that inline.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export default function LessonActionsMenu({
  lessonId,
  lessonTitle,
}: {
  lessonId: string;
  lessonTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click outside / escape closes.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
        setError(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
        setError(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lessons/${lessonId}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.detail ?? body.error ?? "delete_failed");
        setDeleting(false);
        return;
      }
      // Success: close menu, refresh server component so the row disappears.
      setOpen(false);
      setConfirming(false);
      router.refresh();
    } catch {
      setError("network");
      setDeleting(false);
    }
  }

  return (
    <div ref={wrapRef} className={styles.kebabWrap}>
      <button
        type="button"
        className={styles.kebabBtn}
        aria-label={`Actions for ${lessonTitle}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setConfirming(false);
          setError(null);
        }}
      >
        ⋮
      </button>
      {open ? (
        <div className={styles.kebabMenu} role="menu">
          <a
            href={`/admin/lessons/${lessonId}/preview`}
            className={styles.kebabItem}
            role="menuitem"
          >
            Preview as student
          </a>
          <a
            href={`/admin/lessons/${lessonId}/edit`}
            className={styles.kebabItem}
            role="menuitem"
          >
            Edit
          </a>
          {confirming ? (
            <div className={styles.kebabConfirm}>
              <div className={styles.kebabConfirmText}>
                Delete &ldquo;{lessonTitle}&rdquo;?
              </div>
              {error ? (
                <div className={styles.kebabError}>{error}</div>
              ) : null}
              <div className={styles.kebabConfirmActions}>
                <button
                  type="button"
                  className={styles.kebabCancel}
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.kebabDelete}
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Yes, delete"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.kebabItem} ${styles.kebabItemDanger}`}
              role="menuitem"
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
