"use client";

// Master-detail surface. Left rail = compact rows, right pane = full
// detail for the URL-selected client. URL drives selection via the
// `client` query param so deep links + browser back/forward work.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  TrialCardView,
  type TrialCard,
  type ActiveRow,
  type CurriculumWithSlots,
  type CurriculumSlotRow,
} from "../AdminClient";
import MessageThread from "@/components/MessageThread";
import styles from "./clients.module.css";

export type ClientItem = {
  player_id: string;
  kid_first_name: string;
  parent_first_name: string;
  phase: "trial" | "active" | "past_due" | "pending_cancel";
  waiting_on_tim: boolean;
  cycle_lessons?: number;
  cycle_cancels?: number;
  prep_completed?: number;
  total_quests?: number;
  trial?: TrialCard;
  active?: ActiveRow;
};

const PHASE_LABEL: Record<ClientItem["phase"], string> = {
  trial: "Trial",
  active: "Active",
  past_due: "Payment hold",
  pending_cancel: "Pending cancel",
};

function phaseClass(p: ClientItem["phase"]): string {
  switch (p) {
    case "trial":
      return styles.phaseTrial;
    case "active":
      return styles.phaseActive;
    case "past_due":
      return styles.phaseEpic;
    case "pending_cancel":
      return styles.phaseLegendary;
  }
}

export default function ClientsClient({ items }: { items: ClientItem[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("client");
  const selected = selectedId
    ? items.find((i) => i.player_id === selectedId) ?? null
    : null;

  function selectClient(id: string) {
    router.push(`/admin/clients?client=${id}` as never);
  }
  function backToList() {
    router.push("/admin/clients" as never);
  }

  const timWaitingCount = items.filter((i) => i.waiting_on_tim).length;

  return (
    <div className={styles.layout}>
      <aside
        className={`${styles.rail} ${selected ? styles.railHiddenMobile : ""}`}
        aria-label="Client list"
      >
        <div className={styles.railHeader}>
          <span>{items.length} clients</span>
          {timWaitingCount > 0 ? (
            <span className={styles.railHeaderUrgent}>
              {timWaitingCount} on you
            </span>
          ) : null}
        </div>
        {items.length === 0 ? (
          <div className={styles.railEmpty}>
            No clients yet. Trials will appear here as families book.
          </div>
        ) : (
          <ul className={styles.railList}>
            {items.map((item) => {
              const isSelected = item.player_id === selectedId;
              return (
                <li key={item.player_id}>
                  <button
                    type="button"
                    onClick={() => selectClient(item.player_id)}
                    className={`${styles.railRow} ${isSelected ? styles.railRowSelected : ""}`}
                  >
                    <div className={styles.railRowTop}>
                      <span className={styles.railKid}>{item.kid_first_name}</span>
                      {item.waiting_on_tim ? (
                        <span
                          className={styles.dotTim}
                          aria-label="Waiting on you"
                          title="Waiting on you"
                        />
                      ) : null}
                    </div>
                    <div className={styles.railParent}>{item.parent_first_name}</div>
                    <div className={styles.railMeta}>
                      <span className={`${styles.phasePill} ${phaseClass(item.phase)}`}>
                        {PHASE_LABEL[item.phase]}
                      </span>
                      <span className={styles.metaText}>
                        {item.phase === "trial"
                          ? `Prep ${item.prep_completed ?? 0}/${item.total_quests ?? 4}`
                          : `Cycle ${item.cycle_lessons ?? 0}/4`}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section
        className={`${styles.detail} ${!selected ? styles.detailHiddenMobile : ""}`}
        aria-label="Client detail"
      >
        {!selected ? (
          <div className={styles.detailEmpty}>
            <div className={styles.detailEmptyTitle}>Pick a client</div>
            <p className={styles.detailEmptyBody}>
              Tap a row on the left to see Stage C, the prep readout, the
              latest VOD, and the messages thread for that kid.
            </p>
          </div>
        ) : (
          <div className={styles.detailInner}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={backToList}
            >
              Back to list
            </button>
            {selected.trial ? (
              <TrialCardView card={selected.trial} router={router} />
            ) : selected.active ? (
              <ActiveDetail row={selected.active} />
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function ActiveDetail({ row }: { row: ActiveRow }) {
  return (
    <article className={styles.activeCard}>
      <header className={styles.activeHeader}>
        <h2 className={styles.activeKid}>{row.player_first_name}</h2>
        <div className={styles.activeParent}>Parent: {row.parent_first_name}</div>
        <div className={styles.statusRow}>
          {row.status === "past_due" ? (
            <span className={`${styles.pill} ${styles.pillEpic}`}>Payment hold</span>
          ) : row.status === "pending_cancel" ? (
            <span className={`${styles.pill} ${styles.pillLegendary}`}>Pending cancel</span>
          ) : (
            <span className={`${styles.pill} ${styles.pillActive}`}>Active</span>
          )}
          <span className={styles.pill}>
            Cycle {row.cycle_lessons_delivered}/4
          </span>
          <span className={styles.pill}>
            Cancels {row.cycle_cancels_used}/2
          </span>
        </div>
      </header>
      <LessonPlanPanel
        playerId={row.player_id}
        kidFirstName={row.player_first_name}
        curricula={row.curricula}
      />

      <section className={styles.messagesSection}>
        <div className={styles.sectionLabel}>
          Messages with {row.player_first_name}
        </div>
        <MessageThread
          initialMessages={row.messages}
          viewerRole="coach"
          kidFirstName={row.player_first_name}
          endpoint="/api/admin/message"
          playerId={row.player_id}
        />
      </section>
    </article>
  );
}

// ---------------------------------------------------------------------------
// LessonPlanPanel — current cycle + past cycles + swap/VOD controls
// ---------------------------------------------------------------------------

type LibraryLesson = {
  id: string;
  title: string;
  fortnite_label: string;
  parent_label: string;
  topic: string;
  difficulty_level: string;
  duration_minutes: number;
  is_published: boolean;
  already_done: boolean;
};

type ModalKind =
  | { type: "swap"; slot: CurriculumSlotRow }
  | { type: "vod_on"; slot: CurriculumSlotRow }
  | null;

function LessonPlanPanel({
  playerId,
  kidFirstName,
  curricula,
}: {
  playerId: string;
  kidFirstName: string;
  curricula: CurriculumWithSlots[];
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalKind>(null);

  const active = curricula.find((c) => c.status === "active");
  const past = curricula
    .filter((c) => c.status === "completed" || c.status === "superseded")
    .sort((a, b) => (b.approved_at ?? b.created_at).localeCompare(a.approved_at ?? a.created_at));
  const pending = curricula.find((c) => c.status === "pending_approval");

  return (
    <section className={styles.lessonPanel}>
      <div className={styles.sectionLabel}>Lesson plan</div>

      {active ? (
        <CurriculumBlock
          curriculum={active}
          kidFirstName={kidFirstName}
          onSwap={(slot) => setModal({ type: "swap", slot })}
          onVodOn={(slot) => setModal({ type: "vod_on", slot })}
          onVodOff={(slot) => setModal({ type: "swap", slot })}
        />
      ) : pending ? (
        <div className={styles.curriculumBlock}>
          <div className={styles.curriculumStatus}>Pending parent approval</div>
          <CurriculumSlots
            slots={pending.slots}
            kidFirstName={kidFirstName}
            readOnly
          />
        </div>
      ) : (
        <p className={styles.subtle}>No active curriculum yet.</p>
      )}

      {past.length > 0 ? (
        <div className={styles.pastCycles}>
          <div className={styles.subtleLabel}>
            Past cycles ({past.length})
          </div>
          <ul className={styles.pastList}>
            {past.map((c) => (
              <li key={c.id} className={styles.pastItem}>
                <span className={styles.pastDate}>
                  {c.approved_at
                    ? new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }).format(new Date(c.approved_at))
                    : "draft"}
                </span>
                <span className={styles.pastLessons}>
                  {c.slots
                    .map((s) =>
                      s.is_vod_review
                        ? "VOD"
                        : s.lesson?.fortnite_label ?? "Lesson",
                    )
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {modal?.type === "swap" ? (
        <SwapLessonModal
          slot={modal.slot}
          playerId={playerId}
          kidFirstName={kidFirstName}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            router.refresh();
          }}
        />
      ) : null}
      {modal?.type === "vod_on" ? (
        <VodOnModal
          slot={modal.slot}
          kidFirstName={kidFirstName}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function CurriculumBlock({
  curriculum,
  kidFirstName,
  onSwap,
  onVodOn,
  onVodOff,
}: {
  curriculum: CurriculumWithSlots;
  kidFirstName: string;
  onSwap: (slot: CurriculumSlotRow) => void;
  onVodOn: (slot: CurriculumSlotRow) => void;
  onVodOff: (slot: CurriculumSlotRow) => void;
}) {
  return (
    <div className={styles.curriculumBlock}>
      <div className={styles.curriculumStatus}>Current cycle</div>
      {curriculum.personalization_note ? (
        <p className={styles.personalNote}>{curriculum.personalization_note}</p>
      ) : null}
      <CurriculumSlots
        slots={curriculum.slots}
        kidFirstName={kidFirstName}
        onSwap={onSwap}
        onVodOn={onVodOn}
        onVodOff={onVodOff}
      />
    </div>
  );
}

function CurriculumSlots({
  slots,
  kidFirstName,
  readOnly,
  onSwap,
  onVodOn,
  onVodOff,
}: {
  slots: CurriculumSlotRow[];
  kidFirstName: string;
  readOnly?: boolean;
  onSwap?: (slot: CurriculumSlotRow) => void;
  onVodOn?: (slot: CurriculumSlotRow) => void;
  onVodOff?: (slot: CurriculumSlotRow) => void;
}) {
  return (
    <ul className={styles.slotList}>
      {slots.map((s) => {
        const status = slotStatus(s);
        const editable =
          !readOnly && !s.delivered_at && !s.live_call_completed_at;
        return (
          <li
            key={s.id}
            className={`${styles.slotRow} ${status.cls ? styles[status.cls] : ""}`}
          >
            <span className={styles.slotWeek}>W{s.week_number}</span>
            <span className={styles.slotBody}>
              <span className={styles.slotTitle}>
                {s.is_vod_review
                  ? "VOD review"
                  : s.lesson?.fortnite_label ?? "Lesson"}
              </span>
              {s.lesson?.parent_label && !s.is_vod_review ? (
                <span className={styles.slotSub}>{s.lesson.parent_label}</span>
              ) : null}
              {s.is_vod_review && s.vod_url ? (
                <a
                  href={s.vod_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={styles.slotLink}
                >
                  Watch clip
                </a>
              ) : null}
              {s.live_call_at ? (
                <span className={styles.slotWhen}>
                  {new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(s.live_call_at))}
                </span>
              ) : null}
              {s.coach_note ? (
                <span className={styles.slotNote}>Note: {s.coach_note}</span>
              ) : null}
            </span>
            <span className={styles.slotRight}>
              <span className={`${styles.slotPill} ${styles[status.pillCls] ?? ""}`}>
                {status.label}
              </span>
              {editable ? (
                <span className={styles.slotControls}>
                  {s.is_vod_review ? (
                    <button
                      type="button"
                      className={styles.slotBtn}
                      onClick={() => onVodOff?.(s)}
                    >
                      Pick lesson
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.slotBtn}
                        onClick={() => onSwap?.(s)}
                      >
                        Swap
                      </button>
                      <button
                        type="button"
                        className={styles.slotBtnGhost}
                        onClick={() => onVodOn?.(s)}
                      >
                        VOD
                      </button>
                    </>
                  )}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function slotStatus(s: CurriculumSlotRow): {
  label: string;
  cls: string | null;
  pillCls: string;
} {
  if (s.live_call_completed_at)
    return { label: "Completed", cls: "slotRowOk", pillCls: "slotPillOk" };
  if (s.no_show_at)
    return { label: "No show", cls: "slotRowWarn", pillCls: "slotPillWarn" };
  if ((s.live_call_event_id ?? "").startsWith("cancelled:"))
    return { label: "Cancelled", cls: "slotRowMuted", pillCls: "slotPillMuted" };
  if (s.delivered_at)
    return { label: "Delivered", cls: "slotRowOk", pillCls: "slotPillOk" };
  if (s.live_call_at && new Date(s.live_call_at).getTime() < Date.now())
    return { label: "Past, unmarked", cls: "slotRowWarn", pillCls: "slotPillWarn" };
  if (s.live_call_at)
    return { label: "Upcoming", cls: "slotRowNext", pillCls: "slotPillNext" };
  return { label: "Not scheduled", cls: null, pillCls: "slotPillMuted" };
}

// ---------------------------------------------------------------------------
// Swap lesson modal — also handles VOD-off (target lesson selection)
// ---------------------------------------------------------------------------

function SwapLessonModal({
  slot,
  playerId,
  kidFirstName,
  onClose,
  onDone,
}: {
  slot: CurriculumSlotRow;
  playerId: string;
  kidFirstName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState<LibraryLesson[]>([]);
  const [filter, setFilter] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load library on mount.
  if (loading && library.length === 0 && !error) {
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/lessons/library?player_id=${encodeURIComponent(playerId)}`,
        );
        const body = (await res.json().catch(() => ({}))) as {
          lessons?: LibraryLesson[];
          error?: string;
        };
        if (!res.ok || !body.lessons) {
          setError(body.error ?? "Failed to load library.");
        } else {
          setLibrary(body.lessons);
        }
        setLoading(false);
      } catch {
        setError("Could not reach the server.");
        setLoading(false);
      }
    })();
  }

  async function pick(lessonId: string) {
    setError(null);
    setSubmitting(lessonId);
    try {
      // If the slot is currently VOD, the swap-lesson endpoint flips
      // it off VOD automatically (clears vod fields). Same call path.
      const endpoint = slot.is_vod_review
        ? `/api/admin/curriculum-slots/${slot.id}/toggle-vod`
        : `/api/admin/curriculum-slots/${slot.id}/swap-lesson`;
      const payload = slot.is_vod_review
        ? { mode: "vod_off", lesson_id: lessonId }
        : { lesson_id: lessonId };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Swap failed. Try again.");
        setSubmitting(null);
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
      setSubmitting(null);
    }
  }

  const lower = filter.trim().toLowerCase();
  const filtered = lower
    ? library.filter(
        (l) =>
          l.fortnite_label.toLowerCase().includes(lower) ||
          l.parent_label.toLowerCase().includes(lower) ||
          l.topic.toLowerCase().includes(lower),
      )
    : library;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className={styles.modalClose}
          aria-label="Close"
        >
          ×
        </button>
        <div className={styles.modalEyebrow}>Week {slot.week_number}</div>
        <h2 className={styles.modalTitle}>
          {slot.is_vod_review
            ? `Pick a lesson for ${kidFirstName}`
            : `Swap ${kidFirstName}'s Week ${slot.week_number} lesson`}
        </h2>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by title, topic, or skill"
          className={styles.modalInput}
        />

        {loading ? (
          <p className={styles.modalBody}>Loading library...</p>
        ) : error ? (
          <p className={styles.modalError}>{error}</p>
        ) : filtered.length === 0 ? (
          <p className={styles.modalBody}>
            No lessons match. {library.length === 0 ? "Author some at /admin/lessons/new." : null}
          </p>
        ) : (
          <ul className={styles.libraryList}>
            {filtered.map((l) => (
              <li key={l.id} className={styles.libraryItem}>
                <button
                  type="button"
                  className={styles.libraryBtn}
                  onClick={() => pick(l.id)}
                  disabled={submitting !== null}
                >
                  <span className={styles.libraryTitle}>
                    {l.fortnite_label}
                    {l.already_done ? (
                      <span className={styles.libraryBadge}>Already done</span>
                    ) : null}
                    {!l.is_published ? (
                      <span className={styles.libraryBadgeWarn}>Draft</span>
                    ) : null}
                  </span>
                  <span className={styles.librarySub}>
                    {l.parent_label} · {l.topic} · {l.difficulty_level} · {l.duration_minutes} min
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VOD-on modal — paste a VOD URL + optional talking point
// ---------------------------------------------------------------------------

function VodOnModal({
  slot,
  kidFirstName,
  onClose,
  onDone,
}: {
  slot: CurriculumSlotRow;
  kidFirstName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [vodUrl, setVodUrl] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!vodUrl.trim()) {
      setError("Paste a VOD URL.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/curriculum-slots/${slot.id}/toggle-vod`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "vod_on",
          vod_url: vodUrl.trim(),
          vod_note: note.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Couldn't switch to VOD. Try again.");
        setSubmitting(false);
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className={styles.modalClose}
          aria-label="Close"
        >
          ×
        </button>
        <div className={styles.modalEyebrow}>Week {slot.week_number}</div>
        <h2 className={styles.modalTitle}>
          Switch to a VOD review for {kidFirstName}
        </h2>
        <p className={styles.modalBody}>
          Replaces the assigned lesson with a review of a clip {kidFirstName}{" "}
          dropped. Paste the clip URL below.
        </p>
        <label className={styles.modalLabel}>
          <span>VOD URL</span>
          <input
            type="url"
            value={vodUrl}
            onChange={(e) => setVodUrl(e.target.value)}
            placeholder="https://..."
            className={styles.modalInput}
            autoComplete="off"
          />
        </label>
        <label className={styles.modalLabel}>
          <span>Talking point for the parent email (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            className={styles.modalTextarea}
            placeholder={`e.g. ${kidFirstName} was W keying through endgame. We're going to fix that.`}
          />
        </label>
        {error ? <p className={styles.modalError}>{error}</p> : null}
        <div className={styles.modalActions}>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={styles.modalPrimary}
          >
            {submitting ? "Saving..." : "Switch to VOD"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={styles.modalSecondary}
          >
            Never mind
          </button>
        </div>
      </div>
    </div>
  );
}
