"use client";

// Master-detail surface. Left rail = compact rows, right pane = full
// detail for the URL-selected client. URL drives selection via the
// `client` query param so deep links + browser back/forward work.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  TrialCardView,
  ClientIdentityBlock,
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
        <h2 className={styles.activeKid}>
          {row.player_first_name}
          {row.player ? `, ${row.player.age}` : ""}
        </h2>
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

      <ClientIdentityBlock
        player={row.player}
        parent={row.parent}
        latestVodUrl={row.latest_vod_url}
        prep={row.prep}
      />

      <SessionPlanPanel
        playerId={row.player_id}
        kidFirstName={row.player_first_name}
        curricula={row.curricula}
      />

      <section className={styles.messagesSection}>
        <div className={styles.sectionLabel}>
          <span>Messages with {row.player_first_name}</span>
          <a
            href={`/admin/inbox?client=${row.player_id}`}
            className={styles.sectionLabelLink}
          >
            Open in inbox →
          </a>
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
// SessionPlanPanel — current cycle + past cycles
// ---------------------------------------------------------------------------
//
// Was LessonPlanPanel, and it carried the content controls: a Swap button that
// opened a LessonPicker over the published library, a VOD button that turned a
// week into a clip review, and a "Pick lesson" button for a week that had no
// lesson yet. All three are gone with the library.
//
// What a session row shows now is what a session IS: when the call is, whether
// it happened, and whether Tim has written it up.

function SessionPlanPanel({
  playerId,
  kidFirstName,
  curricula,
}: {
  playerId: string;
  kidFirstName: string;
  curricula: CurriculumWithSlots[];
}) {
  const active = curricula.find((c) => c.status === "active");
  const past = curricula
    .filter((c) => c.status === "completed" || c.status === "superseded")
    .sort((a, b) => (b.approved_at ?? b.created_at).localeCompare(a.approved_at ?? a.created_at));
  const pending = curricula.find((c) => c.status === "pending_approval");

  return (
    <section className={styles.lessonPanel}>
      <div className={styles.sectionLabel}>Sessions</div>

      {active ? (
        <CurriculumBlock curriculum={active} kidFirstName={kidFirstName} />
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
        <p className={styles.subtle}>No sessions booked yet.</p>
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
                  {/* Was a list of lesson labels. A past cycle is now
                      summarised by how many of its four sessions actually
                      happened, which is the thing worth seeing at a glance. */}
                  {c.slots.filter((s) => s.live_call_completed_at).length} of{" "}
                  {c.slots.length} sessions completed
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

    </section>
  );
}

function CurriculumBlock({
  curriculum,
  kidFirstName,
}: {
  curriculum: CurriculumWithSlots;
  kidFirstName: string;
}) {
  return (
    <div className={styles.curriculumBlock}>
      <div className={styles.curriculumStatus}>Current cycle</div>
      {curriculum.personalization_note ? (
        <p className={styles.personalNote}>{curriculum.personalization_note}</p>
      ) : null}
      <CurriculumSlots slots={curriculum.slots} kidFirstName={kidFirstName} />
    </div>
  );
}

function CurriculumSlots({
  slots,
}: {
  slots: CurriculumSlotRow[];
  // kidFirstName was used by the swap and VOD modal copy. Both are gone; the
  // prop is kept off the type rather than accepted and ignored.
  kidFirstName?: string;
  readOnly?: boolean;
}) {
  return (
    <ul className={styles.slotList}>
      {slots.map((s) => {
        const status = slotStatus(s);
        return (
          <li
            key={s.id}
            className={`${styles.slotRow} ${status.cls ? styles[status.cls] : ""}`}
          >
            <span className={styles.slotWeek}>W{s.week_number}</span>
            <span className={styles.slotBody}>
              <span className={styles.slotTitle}>
                Session {s.week_number}
              </span>
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
              {/* What Tim wrote up. A completed call with neither is one he
                  has not written up yet, which is worth seeing here. */}
              {s.coach_note ? (
                <span className={styles.slotNote}>Advice: {s.coach_note}</span>
              ) : null}
              {s.training_routine ? (
                <span
                  className={styles.slotNote}
                  /* The advice beside this renders in full, so the routine
                     should too, and a routine is the field that HAS line
                     breaks. Without pre-wrap it collapsed to a run on line
                     here while the student and the parent both saw a list. */
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  Routine: {s.training_routine}
                </span>
              ) : null}
              {s.live_call_completed_at && !s.coach_note && !s.training_routine ? (
                <span className={styles.slotSub}>Not written up yet</span>
              ) : null}
            </span>
            <span className={styles.slotRight}>
              <span className={`${styles.slotPill} ${styles[status.pillCls] ?? ""}`}>
                {status.label}
              </span>
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
