"use client";

// Tim ↔ Dad 1:1 channel. Shared between /admin and /dad. The viewer's
// role is passed in by the parent Server Component (which knows the
// coach's is_dad flag). Sender role on each message is server-side
// derived from coaches.is_dad — viewer.role here just drives the label
// rendering ("You" vs "Tim" vs "Dad").

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./TimDadChannel.module.css";

export type TimDadMessage = {
  id: string;
  sender_role: "tim" | "dad";
  body: string;
  created_at: string;
};

export default function TimDadChannel({
  initialMessages,
  viewerRole,
}: {
  initialMessages: TimDadMessage[];
  viewerRole: "tim" | "dad";
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<TimDadMessage[]>(initialMessages);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages]);

  function labelFor(senderRole: "tim" | "dad"): string {
    if (senderRole === viewerRole) return "You";
    return senderRole === "tim" ? "Tim" : "Dad";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/tim-dad-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "Send failed.");
        setSubmitting(false);
        return;
      }
      const result = (await res.json().catch(() => ({}))) as { message?: TimDadMessage };
      if (result.message) setMessages((prev) => [...prev, result.message!]);
      setBody("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    }
    setSubmitting(false);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.eyebrow}>Tim ↔ Dad</div>
        <div className={styles.subtle}>
          Just between you two. Family-thread messages live elsewhere.
        </div>
      </div>

      {messages.length === 0 ? (
        <div className={styles.empty}>
          Quiet here. Drop a line if you need {viewerRole === "tim" ? "Dad" : "Tim"}.
        </div>
      ) : (
        <div className={styles.list}>
          {messages.map((m) => {
            const own = m.sender_role === viewerRole;
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

      <form className={styles.composer} onSubmit={onSubmit}>
        <textarea
          rows={2}
          maxLength={2000}
          placeholder={viewerRole === "tim" ? "Ask Dad something..." : "Drop Tim a line..."}
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
    </section>
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
