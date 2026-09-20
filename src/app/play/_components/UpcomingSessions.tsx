"use client";

// The kid's upcoming sessions, with the VOD review swap.
//
// This block exists because there was nowhere to put the action. /play had no
// session list at all and /play/training only shows sessions Tim has already
// written up, so before this the kid could not see what was coming, let alone
// change it. A button with no surface to live on is how a capability ends up
// reachable only by people who already know it exists.
//
// Parents see the same sessions on /portal/sessions and get no swap control.
// Peter: "parents are there only to see, for the sake of transparency."

import { useState } from "react";

export type UpcomingSession = {
  id: string;
  week_number: number;
  live_call_at: string | null;
  delivery_mode: string;
  vod_review_by: string | null;
  has_vod: boolean;
};

function when(iso: string | null): string {
  if (!iso) return "Time to be set";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function UpcomingSessions({
  sessions,
  vodReviewsUsed,
  vodReviewsPerCycle,
  className,
}: {
  sessions: UpcomingSession[];
  vodReviewsUsed: number;
  vodReviewsPerCycle: number;
  className?: string;
}) {
  const [rows, setRows] = useState(sessions);
  const [used, setUsed] = useState(vodReviewsUsed);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const left = Math.max(0, vodReviewsPerCycle - used);

  async function swap(id: string) {
    setBusy(id); setError(null);
    try {
      const res = await fetch(`/api/play/sessions/${id}/vod-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(url.trim() ? { vod_url: url.trim() } : {}),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setError(j?.message ?? "That did not work. Try again."); return; }
      setRows((r) => r.map((s) => s.id === id
        ? { ...s, delivery_mode: "vod_review", vod_review_by: "student", live_call_at: null, has_vod: Boolean(url.trim()) }
        : s));
      setUsed(j?.vod_reviews_used ?? used + 1);
      setOpenFor(null); setUrl("");
    } finally { setBusy(null); }
  }

  async function undo(id: string) {
    setBusy(id); setError(null);
    try {
      const res = await fetch(`/api/play/sessions/${id}/vod-review`, { method: "DELETE" });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setError(j?.message ?? "That did not work. Try again."); return; }
      setRows((r) => r.map((s) => s.id === id
        ? { ...s, delivery_mode: "live_call", vod_review_by: null, has_vod: false } : s));
      setUsed((u) => Math.max(0, u - 1));
    } finally { setBusy(null); }
  }

  if (rows.length === 0) return null;

  return (
    <section className={className}>
      <h2>Your sessions</h2>
      <p>
        {left > 0
          ? "Can't make one of these? Swap it for a VOD review instead. Tim watches your gameplay and writes you up the same way."
          : "You have used your VOD review for this cycle. It comes back when your next cycle starts."}
      </p>

      {error ? <p role="alert">{error}</p> : null}

      <ul>
        {rows.map((s) => {
          const isVod = s.delivery_mode === "vod_review";
          const byCoach = s.vod_review_by === "coach";
          return (
            <li key={s.id}>
              <span>Session {s.week_number}</span>{" "}
              <span>
                {isVod
                  ? byCoach
                    ? "VOD review, set by Tim"
                    : "VOD review"
                  : when(s.live_call_at)}
              </span>

              {isVod && !s.has_vod ? (
                <span> Send Tim your VOD link so he can review it.</span>
              ) : null}

              {/* Tim's decision is his. A kid reversing it would be undoing a
                  coaching call, so no control is offered for it at all. */}
              {isVod && !byCoach ? (
                <button type="button" disabled={busy === s.id} onClick={() => undo(s.id)}>
                  {busy === s.id ? "Changing back..." : "Change back to a live call"}
                </button>
              ) : null}

              {!isVod && left > 0 ? (
                openFor === s.id ? (
                  <span>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="Paste your VOD link (you can add it later)"
                      aria-label="VOD link"
                    />
                    <button type="button" disabled={busy === s.id} onClick={() => swap(s.id)}>
                      {busy === s.id ? "Switching..." : "Use my VOD review"}
                    </button>
                    <button type="button" onClick={() => { setOpenFor(null); setUrl(""); }}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setOpenFor(s.id)}>
                    Swap for a VOD review
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      <p>
        VOD reviews used: {used} of {vodReviewsPerCycle} this cycle.
      </p>
    </section>
  );
}
