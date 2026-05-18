"use client";

// Shared message thread component. Three contexts consume it:
//
//   * /play       — kid view: sees "You" vs "Tim". Send box on.
//                   Parent-visibility reminder above the input.
//   * /portal     — parent view: read-only audit. No send box.
//   * /admin      — coach view: sees "You (Tim)" vs the kid's first name.
//                   Send box on, sender_role='coach'.
//
// All three render the same vertical message list; differences are pure
// presentation (label per message, whether the composer renders, the
// endpoint the composer POSTs to).
//
// Real-time updates are NOT wired in this first cut. After a successful
// send the local state appends the message optimistically + router.refresh
// re-fetches the server-rendered initial state. Polling or Supabase
// Realtime subscriptions can layer on later if message volume grows.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./MessageThread.module.css";

export type MessageRow = {
  id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
  created_at: string;
};

export type ViewerRole = "player" | "parent" | "coach";

export default function MessageThread({
  initialMessages,
  viewerRole,
  kidFirstName,
  endpoint,
  playerId,
}: {
  initialMessages: MessageRow[];
  viewerRole: ViewerRole;
  /** First name of the player whose thread this is. Used for "Tim" -> player
   *  label translation when the viewer is the coach. */
  kidFirstName: string;
  /** POST URL for sending. null for read-only views (parent). */
  endpoint: string | null;
  /** Required for the admin composer (Tim needs to specify which player
   *  the message belongs to). Ignored for /play (the kid is always
   *  writing to their own thread via player_id_for_user()). */
  playerId?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Auto-scroll to the latest message on mount + when new ones arrive.
    listEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages]);

  function labelFor(senderRole: MessageRow["sender_role"]): string {
    if (senderRole === "bot") return "XPL Keyed";
    if (senderRole === "coach") return viewerRole === "coach" ? "You (Tim)" : "Tim";
    // sender_role === 'player'
    if (viewerRole === "player") return "You";
    if (viewerRole === "coach") return kidFirstName;
    return kidFirstName; // parent
  }

  function isOwnMessage(senderRole: MessageRow["sender_role"]): boolean {
    if (viewerRole === "player" && senderRole === "player") return true;
    if (viewerRole === "coach" && senderRole === "coach") return true;
    return false;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!endpoint) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, string> = { body: trimmed };
      if (playerId) payload.player_id = playerId;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not send. Try again in a moment.");
        setSubmitting(false);
        return;
      }
      const result = (await res.json().catch(() => ({}))) as {
        message?: MessageRow;
      };
      if (result.message) {
        setMessages((prev) => [...prev, result.message!]);
      }
      setBody("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    }
    setSubmitting(false);
  }

  return (
    <div className={styles.thread}>
      {messages.length === 0 ? (
        <div className={styles.empty}>
          {viewerRole === "player"
            ? "No messages yet. Tap below to write Tim."
            : viewerRole === "parent"
              ? "No messages yet. Anything Tim and your child write will show up here."
              : "No messages yet. Reply below to start the thread."}
        </div>
      ) : (
        <div className={styles.list}>
          {messages.map((m) => {
            const own = isOwnMessage(m.sender_role);
            return (
              <div
                key={m.id}
                className={`${styles.message} ${own ? styles.messageOwn : styles.messageOther}`}
              >
                <div className={styles.bubble}>
                  <div className={styles.sender}>{labelFor(m.sender_role)}</div>
                  <div className={styles.body}>{m.body}</div>
                  <div className={styles.timestamp}>{formatTimestamp(m.created_at)}</div>
                </div>
              </div>
            );
          })}
          <div ref={listEndRef} />
        </div>
      )}

      {endpoint ? (
        <form className={styles.composer} onSubmit={onSubmit}>
          {viewerRole === "player" ? (
            <div className={styles.visibilityHint}>
              Your parents can read every message in here. Coaching only happens in the server.
            </div>
          ) : null}
          <textarea
            rows={2}
            maxLength={2000}
            placeholder={viewerRole === "coach" ? `Reply to ${kidFirstName}...` : "Write Tim..."}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={styles.input}
          />
          <div className={styles.composerRow}>
            <button
              type="submit"
              className={styles.sendBtn}
              disabled={submitting || !body.trim()}
            >
              {submitting ? "Sending..." : "Send"}
            </button>
            {error ? <div className={styles.error}>{error}</div> : null}
          </div>
        </form>
      ) : (
        <div className={styles.parentNote}>
          Read only. You see every message between {kidFirstName} and Tim.
        </div>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d).toLowerCase().replace(" ", "");
  if (sameDay) return time;
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
  return `${datePart}, ${time}`;
}
