"use client";

// Three-dot kebab menu on each lesson row in /admin/lessons.
// Actions:
//   - Preview as student
//   - Edit: opens the planner at /admin/lessons/[id]/edit
//   - Rename: inline input, PATCHes the title without navigating away
//   - Delete: two-step inline confirm; 409 surfaces the detail message

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
  const [view, setView] = useState<"menu" | "rename" | "confirmDelete">("menu");
  const [renameValue, setRenameValue] = useState(lessonTitle);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the rename input when that view opens.
  useEffect(() => {
    if (view === "rename" && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [view]);

  function close() {
    setOpen(false);
    setView("menu");
    setError(null);
  }

  // Click outside / escape closes.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRename() {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setRenaming(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lessons/${lessonId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "rename_failed");
        setRenaming(false);
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("network");
      setRenaming(false);
    }
  }

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
      close();
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
          setView("menu");
          setError(null);
        }}
      >
        ⋮
      </button>
      {open ? (
        <div className={styles.kebabMenu} role="menu">
          {view === "rename" ? (
            <div className={styles.kebabConfirm}>
              <input
                ref={renameInputRef}
                type="text"
                className={styles.kebabRenameInput}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRename();
                  if (e.key === "Escape") close();
                }}
                maxLength={120}
                placeholder="Lesson title"
              />
              {error ? <div className={styles.kebabError}>{error}</div> : null}
              <div className={styles.kebabConfirmActions}>
                <button
                  type="button"
                  className={styles.kebabCancel}
                  onClick={close}
                  disabled={renaming}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.kebabSave}
                  onClick={() => void handleRename()}
                  disabled={renaming || !renameValue.trim()}
                >
                  {renaming ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : view === "confirmDelete" ? (
            <div className={styles.kebabConfirm}>
              <div className={styles.kebabConfirmText}>
                Delete &ldquo;{lessonTitle}&rdquo;?
              </div>
              {error ? <div className={styles.kebabError}>{error}</div> : null}
              <div className={styles.kebabConfirmActions}>
                <button
                  type="button"
                  className={styles.kebabCancel}
                  onClick={() => { setView("menu"); setError(null); }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.kebabDelete}
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Yes, delete"}
                </button>
              </div>
            </div>
          ) : (
            <>
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
              <button
                type="button"
                className={styles.kebabItem}
                role="menuitem"
                onClick={() => {
                  setRenameValue(lessonTitle);
                  setView("rename");
                  setError(null);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className={`${styles.kebabItem} ${styles.kebabItemDanger}`}
                role="menuitem"
                onClick={() => setView("confirmDelete")}
              >
                Delete
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
