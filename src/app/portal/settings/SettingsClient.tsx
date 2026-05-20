"use client";

// Two side-by-side forms: parent name + player profile. Each form posts
// to /api/portal/settings and re-renders on success via router.refresh().
//
// State machine per form: idle -> submitting -> (saved | error). Saved
// stays on screen for ~3 seconds so the user gets a confirmation, then
// drops back to idle.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../_components/inner-page.module.css";

const RANKS = [
  "Not ranked yet",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Elite",
  "Champion",
  "Unreal",
] as const;

const PLATFORMS = ["PC", "PlayStation", "Xbox", "Switch", "Mobile"] as const;

type Stage = "idle" | "submitting" | "saved" | "error";

export default function SettingsClient({
  initialParent,
  initialPlayer,
}: {
  initialParent: { first_name: string; email: string };
  initialPlayer: {
    id: string;
    first_name: string;
    age: number;
    fortnite_username: string | null;
    discord_username: string | null;
    current_rank: string | null;
    platform: string | null;
    hours_per_week: number | null;
  };
}) {
  const router = useRouter();

  const [parentName, setParentName] = useState(initialParent.first_name);
  const [parentStage, setParentStage] = useState<Stage>("idle");
  const [parentError, setParentError] = useState<string | null>(null);

  const [playerFirst, setPlayerFirst] = useState(initialPlayer.first_name);
  const [ign, setIgn] = useState(initialPlayer.fortnite_username ?? "");
  const [discord, setDiscord] = useState(initialPlayer.discord_username ?? "");
  const [rank, setRank] = useState(initialPlayer.current_rank ?? "");
  const [platform, setPlatform] = useState(initialPlayer.platform ?? "");
  const [hours, setHours] = useState<string>(
    initialPlayer.hours_per_week != null ? String(initialPlayer.hours_per_week) : "",
  );
  const [playerStage, setPlayerStage] = useState<Stage>("idle");
  const [playerError, setPlayerError] = useState<string | null>(null);

  async function saveParent(e: React.FormEvent) {
    e.preventDefault();
    setParentError(null);
    const trimmed = parentName.trim();
    if (!trimmed) {
      setParentError("First name can't be empty.");
      return;
    }
    setParentStage("submitting");
    try {
      const res = await fetch("/api/portal/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parent: { first_name: trimmed } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setParentError(body.error ?? "Save failed. Try again.");
        setParentStage("error");
        return;
      }
      setParentStage("saved");
      router.refresh();
      window.setTimeout(() => setParentStage("idle"), 3000);
    } catch {
      setParentError("Could not reach the server.");
      setParentStage("error");
    }
  }

  async function savePlayer(e: React.FormEvent) {
    e.preventDefault();
    setPlayerError(null);
    const trimmedFirst = playerFirst.trim();
    if (!trimmedFirst) {
      setPlayerError("First name can't be empty.");
      return;
    }
    const hoursNum = hours === "" ? null : Number(hours);
    if (hoursNum != null && (!Number.isFinite(hoursNum) || hoursNum < 0 || hoursNum > 168)) {
      setPlayerError("Hours per week must be between 0 and 168.");
      return;
    }
    setPlayerStage("submitting");
    try {
      const res = await fetch("/api/portal/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player: {
            id: initialPlayer.id,
            first_name: trimmedFirst,
            fortnite_username: ign.trim() || null,
            discord_username: discord.trim() || null,
            current_rank: rank || null,
            platform: platform || null,
            hours_per_week: hoursNum,
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPlayerError(body.error ?? "Save failed. Try again.");
        setPlayerStage("error");
        return;
      }
      setPlayerStage("saved");
      router.refresh();
      window.setTimeout(() => setPlayerStage("idle"), 3000);
    } catch {
      setPlayerError("Could not reach the server.");
      setPlayerStage("error");
    }
  }

  return (
    <>
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Parent</div>
        <h2 className={styles.cardTitle}>Your contact info</h2>
        <form className={styles.form} onSubmit={saveParent}>
          <div className={styles.formRow}>
            <label htmlFor="parent-name" className={styles.formLabel}>First name</label>
            <input
              id="parent-name"
              className={styles.formInput}
              type="text"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              maxLength={80}
              autoComplete="given-name"
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="parent-email" className={styles.formLabel}>Email</label>
            <input
              id="parent-email"
              className={styles.formInput}
              type="email"
              value={initialParent.email}
              disabled
              aria-describedby="parent-email-note"
            />
          </div>
          <p id="parent-email-note" className={styles.formNote}>
            Email change has to be done by Tim so your sign in links keep working.
            Reach out at tim@xplkeyed.com.
          </p>
          <div className={styles.formActions}>
            <button
              type="submit"
              className={styles.saveBtn}
              disabled={parentStage === "submitting"}
            >
              {parentStage === "submitting" ? "Saving..." : "Save parent info"}
            </button>
            {parentStage === "saved" ? (
              <span className={styles.statusOk}>Saved.</span>
            ) : null}
            {parentError ? (
              <span className={styles.statusError}>{parentError}</span>
            ) : null}
          </div>
        </form>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Player</div>
        <h2 className={styles.cardTitle}>{initialPlayer.first_name}&apos;s player profile</h2>
        <form className={styles.form} onSubmit={savePlayer}>
          <div className={styles.formRow}>
            <label htmlFor="player-first" className={styles.formLabel}>First name</label>
            <input
              id="player-first"
              className={styles.formInput}
              type="text"
              value={playerFirst}
              onChange={(e) => setPlayerFirst(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="player-age" className={styles.formLabel}>Age</label>
            <input
              id="player-age"
              className={styles.formInput}
              type="number"
              value={initialPlayer.age || ""}
              disabled
              aria-describedby="player-age-note"
            />
          </div>
          <p id="player-age-note" className={styles.formNote}>
            Set at intake. Email Tim if {initialPlayer.first_name}&apos;s
            birthday is approaching or there&apos;s a correction.
          </p>
          <div className={styles.formRow}>
            <label htmlFor="player-ign" className={styles.formLabel}>Fortnite IGN</label>
            <input
              id="player-ign"
              className={styles.formInput}
              type="text"
              value={ign}
              onChange={(e) => setIgn(e.target.value)}
              maxLength={64}
              placeholder="Their IGN"
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="player-discord" className={styles.formLabel}>Discord username</label>
            <input
              id="player-discord"
              className={styles.formInput}
              type="text"
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
              maxLength={64}
              placeholder="Their Discord handle"
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="player-rank" className={styles.formLabel}>Current rank</label>
            <select
              id="player-rank"
              className={styles.formSelect}
              value={rank}
              onChange={(e) => setRank(e.target.value)}
            >
              <option value="">Pick one</option>
              {RANKS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <label htmlFor="player-platform" className={styles.formLabel}>Platform</label>
            <select
              id="player-platform"
              className={styles.formSelect}
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option value="">Pick one</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <label htmlFor="player-hours" className={styles.formLabel}>Hours per week</label>
            <input
              id="player-hours"
              className={styles.formInput}
              type="number"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              min={0}
              max={168}
              placeholder="Rough estimate"
            />
          </div>
          <div className={styles.formActions}>
            <button
              type="submit"
              className={styles.saveBtn}
              disabled={playerStage === "submitting"}
            >
              {playerStage === "submitting" ? "Saving..." : "Save player profile"}
            </button>
            {playerStage === "saved" ? (
              <span className={styles.statusOk}>Saved.</span>
            ) : null}
            {playerError ? (
              <span className={styles.statusError}>{playerError}</span>
            ) : null}
          </div>
        </form>
      </section>
    </>
  );
}
