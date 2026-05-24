"use client";

// Bundles tab content on /admin/lessons.
//
// Two states:
//   - List of bundles + a "+ New bundle" button. Each bundle row
//     expands inline to manage its lessons (pick which ones belong,
//     reorder, save).
//   - Inline create form when the new-bundle button is clicked.
//
// API surfaces touched:
//   POST   /api/admin/lesson-bundles                     create
//   PATCH  /api/admin/lesson-bundles/[id]                update meta
//   DELETE /api/admin/lesson-bundles/[id]                delete bundle
//   PUT    /api/admin/lesson-bundles/[id]/lessons        set membership
//
// All mutations call router.refresh() so the Server Component re-runs
// and the bundle list / lesson counts stay accurate.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type Bundle = {
  id: string;
  title: string;
  description: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

type LessonShort = {
  id: string;
  title: string;
  is_published: boolean;
  bundle_id: string | null;
  bundle_position: number | null;
};

export default function BundlesTab({
  bundles,
  allLessons,
}: {
  bundles: Bundle[];
  allLessons: LessonShort[];
}) {
  const [creating, setCreating] = useState(false);

  if (bundles.length === 0 && !creating) {
    return (
      <section className={styles.empty}>
        <p style={{ marginBottom: 12 }}>
          No bundles yet. Bundles group related lessons into a series or
          course (e.g. &ldquo;Building Fundamentals&rdquo;).
        </p>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => setCreating(true)}
        >
          + Create your first bundle
        </button>
      </section>
    );
  }

  return (
    <section>
      <div className={styles.bundlesToolbar}>
        {!creating ? (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setCreating(true)}
          >
            + New bundle
          </button>
        ) : null}
      </div>
      {creating ? (
        <CreateBundleForm
          onCancel={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      ) : null}
      <ul className={styles.bundleList}>
        {bundles.map((b) => {
          const members = allLessons
            .filter((l) => l.bundle_id === b.id)
            .sort(
              (a, c) =>
                (a.bundle_position ?? 0) - (c.bundle_position ?? 0),
            );
          return (
            <BundleRow key={b.id} bundle={b} members={members} allLessons={allLessons} />
          );
        })}
      </ul>
    </section>
  );
}

function CreateBundleForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/lesson-bundles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "create_failed");
        setSubmitting(false);
        return;
      }
      onCreated();
      router.refresh();
    } catch {
      setError("network");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.bundleCreate}>
      <h3 className={styles.bundleCreateTitle}>New bundle</h3>
      <div className={styles.field}>
        <label className={styles.fieldLabel}>Title</label>
        <input
          type="text"
          className={styles.fieldInput}
          placeholder="e.g. Building Fundamentals"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel}>Description (optional)</label>
        <textarea
          className={styles.fieldTextarea}
          placeholder="What the bundle covers, who it's for"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
      </div>
      {error ? <p className={styles.bundleError}>Create failed ({error}).</p> : null}
      <div className={styles.bundleActions}>
        <button type="button" className={styles.bundleGhostBtn} onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={submit}
          disabled={!title.trim() || submitting}
        >
          {submitting ? "Creating..." : "Create bundle"}
        </button>
      </div>
    </div>
  );
}

function BundleRow({
  bundle,
  members,
  allLessons,
}: {
  bundle: Bundle;
  members: LessonShort[];
  allLessons: LessonShort[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(bundle.title);
  const [description, setDescription] = useState(bundle.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function saveMeta() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lesson-bundles/${bundle.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "save_failed");
        setSaving(false);
        return;
      }
      setEditing(false);
      setSaving(false);
      router.refresh();
    } catch {
      setError("network");
      setSaving(false);
    }
  }

  async function deleteBundle() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lesson-bundles/${bundle.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "delete_failed");
        setSaving(false);
        return;
      }
      router.refresh();
    } catch {
      setError("network");
      setSaving(false);
    }
  }

  return (
    <li className={styles.bundleRow}>
      <div className={styles.bundleHeader}>
        {editing ? (
          <div className={styles.bundleEdit}>
            <input
              type="text"
              className={styles.fieldInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
            />
            <textarea
              className={styles.fieldTextarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
            <div className={styles.bundleActions}>
              <button type="button" className={styles.bundleGhostBtn} onClick={() => { setEditing(false); setTitle(bundle.title); setDescription(bundle.description ?? ""); }} disabled={saving}>
                Cancel
              </button>
              <button type="button" className={styles.primaryBtn} onClick={saveMeta} disabled={!title.trim() || saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={styles.bundleHeaderMain}
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
            >
              <div>
                <div className={styles.bundleTitle}>{bundle.title}</div>
                {bundle.description ? (
                  <div className={styles.bundleDesc}>{bundle.description}</div>
                ) : null}
                <div className={styles.bundleMeta}>
                  {members.length} lesson{members.length === 1 ? "" : "s"} · {bundle.is_published ? "Published" : "Internal"}
                </div>
              </div>
              <span className={styles.bundleChevron}>{expanded ? "−" : "+"}</span>
            </button>
            <div className={styles.bundleHeaderActions}>
              <button type="button" className={styles.bundleGhostBtn} onClick={() => setEditing(true)}>Edit</button>
              {confirmDelete ? (
                <>
                  <button type="button" className={styles.bundleGhostBtn} onClick={() => setConfirmDelete(false)} disabled={saving}>Cancel</button>
                  <button type="button" className={styles.bundleDangerBtn} onClick={deleteBundle} disabled={saving}>
                    {saving ? "Deleting..." : "Yes, delete"}
                  </button>
                </>
              ) : (
                <button type="button" className={styles.bundleDangerBtn} onClick={() => setConfirmDelete(true)}>Delete</button>
              )}
            </div>
          </>
        )}
      </div>
      {error ? <p className={styles.bundleError}>{error}</p> : null}
      {expanded && !editing ? (
        <BundleMembership bundleId={bundle.id} members={members} allLessons={allLessons} />
      ) : null}
    </li>
  );
}

function BundleMembership({
  bundleId,
  members,
  allLessons,
}: {
  bundleId: string;
  members: LessonShort[];
  allLessons: LessonShort[];
}) {
  const router = useRouter();
  // Local working list: starts from the saved members.
  const [order, setOrder] = useState<string[]>(members.map((m) => m.id));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lessons available to add: any lesson not already in the order list.
  const available = allLessons.filter((l) => !order.includes(l.id));

  function move(idx: number, delta: number) {
    const ni = idx + delta;
    if (ni < 0 || ni >= order.length) return;
    const next = [...order];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    setOrder(next);
    setSaved(false);
  }

  function remove(id: string) {
    setOrder(order.filter((i) => i !== id));
    setSaved(false);
  }

  function add(id: string) {
    if (!order.includes(id)) {
      setOrder([...order, id]);
      setSaved(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lesson-bundles/${bundleId}/lessons`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lesson_ids: order }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "save_failed");
        setSaving(false);
        return;
      }
      setSaved(true);
      setSaving(false);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("network");
      setSaving(false);
    }
  }

  const lessonById = new Map(allLessons.map((l) => [l.id, l]));

  return (
    <div className={styles.bundleMembership}>
      <h4 className={styles.bundleSectionLabel}>Lessons in this bundle</h4>
      {order.length === 0 ? (
        <p className={styles.bundleEmpty}>No lessons added yet.</p>
      ) : (
        <ol className={styles.bundleMembers}>
          {order.map((id, idx) => {
            const l = lessonById.get(id);
            if (!l) return null;
            return (
              <li key={id} className={styles.bundleMember}>
                <span className={styles.bundleMemberNum}>{idx + 1}</span>
                <span className={styles.bundleMemberTitle}>{l.title}</span>
                <span className={styles.bundleMemberMeta}>{l.is_published ? "Published" : "Draft"}</span>
                <div className={styles.bundleMemberActions}>
                  <button type="button" className={styles.bundleArrowBtn} disabled={idx === 0} onClick={() => move(idx, -1)} aria-label="Move up">↑</button>
                  <button type="button" className={styles.bundleArrowBtn} disabled={idx === order.length - 1} onClick={() => move(idx, 1)} aria-label="Move down">↓</button>
                  <button type="button" className={styles.bundleRemoveBtn} onClick={() => remove(id)} aria-label="Remove from bundle">×</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {available.length > 0 ? (
        <>
          <h4 className={styles.bundleSectionLabel} style={{ marginTop: 18 }}>Add a lesson</h4>
          <div className={styles.bundleAddList}>
            {available.slice(0, 20).map((l) => (
              <button
                key={l.id}
                type="button"
                className={styles.bundleAddItem}
                onClick={() => add(l.id)}
              >
                + {l.title}
                <span className={styles.bundleAddMeta}>{l.is_published ? "Published" : "Draft"}</span>
              </button>
            ))}
            {available.length > 20 ? (
              <p className={styles.fieldHint}>Showing 20 of {available.length}. Refresh after adding to see more.</p>
            ) : null}
          </div>
        </>
      ) : null}

      {error ? <p className={styles.bundleError}>{error}</p> : null}

      <div className={styles.bundleActions} style={{ marginTop: 16 }}>
        {saved ? <span className={styles.bundleSaved}>✓ Saved</span> : null}
        <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save bundle order"}
        </button>
      </div>
    </div>
  );
}
