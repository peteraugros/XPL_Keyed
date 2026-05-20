"use client";

// Kid-facing profile edit form. POSTs to /api/play/profile which
// validates and writes via the kid's own session (RLS does the rest).

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

export default function LoadoutClient({
  initialPlayer,
}: {
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
  const [ign, setIgn] = useState(initialPlayer.fortnite_username ?? "");
  const [discord, setDiscord] = useState(initialPlayer.discord_username ?? "");
  const [rank, setRank] = useState(initialPlayer.current_rank ?? "");
  const [platform, setPlatform] = useState(initialPlayer.platform ?? "");
  const [hours, setHours] = useState<string>(
    initialPlayer.hours_per_week != null ? String(initialPlayer.hours_per_week) : "",
  );
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const hoursNum = hours === "" ? null : Number(hours);
    if (hoursNum != null && (!Number.isFinite(hoursNum) || hoursNum < 0 || hoursNum > 168)) {
      setError("Hours has to be between 0 and 168.");
      return;
    }
    setStage("submitting");
    try {
      const res = await fetch("/api/play/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fortnite_username: ign.trim() || null,
          discord_username: discord.trim() || null,
          current_rank: rank || null,
          platform: platform || null,
          hours_per_week: hoursNum,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Save failed. Try again.");
        setStage("error");
        return;
      }
      setStage("saved");
      router.refresh();
      window.setTimeout(() => setStage("idle"), 3000);
    } catch {
      setError("Could not reach the server.");
      setStage("error");
    }
  }

  return (
    <>
      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Locked fields</div>
        <h2 className={styles.cardTitle}>{initialPlayer.first_name}, age {initialPlayer.age}</h2>
        <p className={styles.cardBody}>
          Your first name and age can only be changed by your parents
          (they handle the account stuff). Everything below is yours to
          edit.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Your gear</div>
        <h2 className={styles.cardTitle}>What Tim sees about you</h2>
        <form className={styles.form} onSubmit={save}>
          <div className={styles.formRow}>
            <label htmlFor="ign" className={styles.formLabel}>Fortnite IGN</label>
            <input
              id="ign"
              className={styles.formInput}
              type="text"
              value={ign}
              onChange={(e) => setIgn(e.target.value)}
              maxLength={64}
              placeholder="Your IGN"
            />
          </div>

          <div className={styles.formRow}>
            <label htmlFor="discord" className={styles.formLabel}>Discord username</label>
            <input
              id="discord"
              className={styles.formInput}
              type="text"
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
              maxLength={64}
              placeholder="Where Tim DMs the squad invite"
            />
          </div>

          <div className={styles.formRow}>
            <label htmlFor="rank" className={styles.formLabel}>Current rank</label>
            <select
              id="rank"
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
            <label htmlFor="platform" className={styles.formLabel}>Platform</label>
            <select
              id="platform"
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
            <label htmlFor="hours" className={styles.formLabel}>Hours per week</label>
            <input
              id="hours"
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
              disabled={stage === "submitting"}
            >
              {stage === "submitting" ? "Saving..." : "Save loadout"}
            </button>
            {stage === "saved" ? (
              <span className={styles.statusOk}>Saved.</span>
            ) : null}
            {error ? <span className={styles.statusError}>{error}</span> : null}
          </div>
        </form>
      </section>
    </>
  );
}
