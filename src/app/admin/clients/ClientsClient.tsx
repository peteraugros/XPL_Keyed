"use client";

// Master-detail surface. Left rail = compact rows, right pane = full
// detail for the URL-selected client. URL drives selection via the
// `client` query param so deep links + browser back/forward work.

import { useRouter, useSearchParams } from "next/navigation";
import { TrialCardView, type TrialCard, type ActiveRow } from "../AdminClient";
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
