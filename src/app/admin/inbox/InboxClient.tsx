"use client";

// InboxClient
// -----------
// Two-pane layout. Left: list of every player ordered by latest
// activity. Right: selected thread (full history) or an empty state
// nudge to pick a conversation.
//
// Selection happens via ?client=<player_id> in the URL — clicking a
// row is just a Link navigation, which re-runs the Server Component
// and refetches the messages for that player. No client-side state
// machinery for selection.

import Link from "next/link";
import MessageThread from "@/components/MessageThread";
import type { InboxListItem } from "./page";
import styles from "./inbox.module.css";

type MessageRow = {
  id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
  created_at: string;
  read_by_recipient_at?: string | null;
  read_by_parent_at?: string | null;
};

export default function InboxClient({
  items,
  selectedPlayerId,
  selectedThread,
  selectedHeader,
}: {
  coachId: string;
  items: InboxListItem[];
  selectedPlayerId: string | null;
  selectedThread: MessageRow[] | null;
  selectedHeader: InboxListItem | null;
}) {
  return (
    <div
      className={`${styles.page} ${selectedPlayerId ? styles.pageWithDetail : ""}`}
    >
      {/* List column. On mobile it's hidden when a thread is open so
          the detail gets the full width; the "Back" link in the detail
          header navigates back to the list-only view. */}
      <aside className={styles.listColumn}>
        <header className={styles.listHeader}>
          <div className={styles.listEyebrow}>Inbox</div>
          <h1 className={styles.listTitle}>Conversations</h1>
          <p className={styles.listSubtitle}>
            One place for every thread. Click a name to open the full history.
          </p>
        </header>

        {items.length === 0 ? (
          <div className={styles.empty}>
            No clients yet. Once Tim takes on a kid, their thread shows up here.
          </div>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.player_id}>
                <Link
                  href={`/admin/inbox?client=${item.player_id}` as never}
                  className={`${styles.row} ${
                    selectedPlayerId === item.player_id ? styles.rowActive : ""
                  } ${item.unread_count > 0 ? styles.rowUnread : ""}`}
                >
                  <div className={styles.rowTopLine}>
                    <span className={styles.rowName}>{item.kid_first_name}</span>
                    {item.latest_message ? (
                      <span className={styles.rowTime}>
                        {formatShortTime(item.latest_message.created_at)}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.rowSecondLine}>
                    {item.latest_message ? (
                      <span className={styles.rowPreview}>
                        <span className={styles.rowSender}>
                          {item.latest_message.sender_role === "coach"
                            ? "You: "
                            : `${item.kid_first_name}: `}
                        </span>
                        {item.latest_message.body.slice(0, 60).trim()}
                        {item.latest_message.body.length > 60 ? "..." : ""}
                      </span>
                    ) : (
                      <span className={styles.rowPreviewMuted}>
                        No messages yet
                      </span>
                    )}
                    {item.unread_count > 0 ? (
                      <span className={styles.unreadBadge}>
                        {item.unread_count}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.rowThirdLine}>
                    Parent: {item.parent_first_name}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Detail column. Empty state nudge when nothing selected. */}
      <section className={styles.detailColumn}>
        {selectedPlayerId && selectedHeader && selectedThread ? (
          <>
            <header className={styles.detailHeader}>
              <Link
                href={"/admin/inbox" as never}
                className={styles.detailBack}
              >
                ← All conversations
              </Link>
              <h2 className={styles.detailTitle}>
                {selectedHeader.kid_first_name}
              </h2>
              <div className={styles.detailMeta}>
                Parent: {selectedHeader.parent_first_name} ·{" "}
                <a
                  href={`/admin/clients?client=${selectedPlayerId}`}
                  className={styles.detailClientLink}
                >
                  Open client card
                </a>
              </div>
            </header>

            <MessageThread
              // Force remount when the selected player changes so the
              // component's internal useState (which seeds from
              // initialMessages on first mount only) gets reset to
              // the new thread instead of keeping the previous one.
              key={selectedPlayerId}
              initialMessages={selectedThread}
              viewerRole="coach"
              kidFirstName={selectedHeader.kid_first_name}
              endpoint="/api/admin/message"
              playerId={selectedPlayerId}
            />
          </>
        ) : (
          <div className={styles.detailEmpty}>
            <div className={styles.detailEmptyEyebrow}>Inbox</div>
            <p className={styles.detailEmptyBody}>
              Pick a conversation on the left to open the full history.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// "2h", "3d", "May 22" — compact relative timestamp for the row.
function formatShortTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}
