// /play/training — My Training.
//
// The player's current coaching instructions. Replaces the Lesson library as
// the thing a player opens between calls, and it is deliberately NOT a
// library: there is no catalogue, no browsing, no watching. It answers one
// question, "what am I supposed to be doing right now", and keeps earlier
// sessions underneath in case they want to look back.
//
// Reads what Tim wrote on the session after the call:
//   training_routine  — what to work on before the next call
//   coach_note        — his advice, in the player's own vocabulary
//
// parent_summary is deliberately NOT read here. That column exists so the
// parent gets a legible line under Hard rule #4; showing it to the player
// would just be the same thing said twice in a register written for someone
// else.
//
// RLS: reads go through the player's cookie session. curriculum_slots has no
// player specific policy, but curriculum_slots_family_select resolves through
// family_id_for_user(), which is a UNION over parents AND players, so a
// player's synthetic auth user does resolve to their family. Verified before
// this page was written rather than assumed; no policy change was needed.

import { requirePlayerSession } from "../_lib/session";
import styles from "../_components/inner-page.module.css";
import training from "./training.module.css";

export const dynamic = "force-dynamic";

type SubLookup = { status: string; tier: string | null };
type CurriculumLookup = { id: string };
type SessionRow = {
  week_number: number;
  live_call_at: string | null;
  live_call_completed_at: string | null;
  coach_note: string | null;
  coach_note_at: string | null;
  training_routine: string | null;
  training_routine_at: string | null;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default async function TrainingPage() {
  const { supabase, player } = await requirePlayerSession();

  const subResp = await supabase
    .from("subscriptions")
    .select("status, tier")
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subResp.data as SubLookup | null;

  // Every curriculum this player has ever had, so looking back works across
  // completed cycles rather than only the current one.
  const curriculaResp = await supabase
    .from("curricula")
    .select("id")
    .eq("player_id", player.id);
  const curriculumIds = ((curriculaResp.data ?? []) as CurriculumLookup[]).map((c) => c.id);

  let sessions: SessionRow[] = [];
  if (curriculumIds.length > 0) {
    const resp = await supabase
      .from("curriculum_slots")
      .select(
        "week_number, live_call_at, live_call_completed_at, coach_note, coach_note_at, training_routine, training_routine_at",
      )
      .in("curriculum_id", curriculumIds)
      .order("live_call_at", { ascending: false, nullsFirst: false });
    sessions = (resp.data ?? []) as SessionRow[];
  }

  // A session only belongs on this page once Tim has actually written
  // something on it. A completed call with no note and no routine is not
  // "empty coaching", it is a call Tim has not written up yet, and rendering
  // a blank card for it would read as the feature being broken.
  const written = sessions.filter((s) => s.coach_note || s.training_routine);
  const current = written[0] ?? null;
  const earlier = written.slice(1);

  const phase =
    sub?.status === "active"
      ? "active"
      : sub?.status === "past_due" || sub?.status === "pending_cancel"
        ? "paused"
        : sub?.status === "canceled" || sub?.status === "declined"
          ? "ended"
          : "trial";

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Training</div>
        <h1 className={styles.title}>My training</h1>
        <p className={styles.intro}>
          {current
            ? "What Tim wants you working on before your next call."
            : phase === "trial"
              ? "After your first call, Tim writes up what to work on and it lands here."
              : phase === "paused"
                ? "Your coaching is on hold. Whatever Tim last gave you is still here."
                : phase === "ended"
                  ? "Your coaching has wrapped. Everything Tim gave you stays here."
                  : "After your next call, Tim writes up what to work on and it lands here."}
        </p>
      </section>

      {current ? (
        <section className={training.currentCard}>
          <div className={training.currentEyebrow}>Right now</div>
          {current.live_call_at ? (
            <div className={training.currentWhen}>
              From your call on {formatWhen(current.live_call_at)}
            </div>
          ) : null}

          {current.training_routine ? (
            <div className={training.block}>
              <span className={training.blockLabel}>Your routine</span>
              <p className={training.body}>{current.training_routine}</p>
            </div>
          ) : null}

          {current.coach_note ? (
            <div className={training.blockQuiet}>
              <span className={training.blockLabelQuiet}>What Tim said</span>
              <p className={training.body}>{current.coach_note}</p>
            </div>
          ) : null}
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Right now</div>
          <h2 className={styles.cardTitle}>Nothing yet</h2>
          <p className={training.empty}>
            {phase === "trial"
              ? "Once you have had your first call with Tim, this is where your routine shows up. Check back after you talk."
              : "Tim writes this up after each call. If you just had one, give him a bit."}
          </p>
        </section>
      )}

      {earlier.length > 0 ? (
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Earlier</div>
          <h2 className={styles.cardTitle}>Previous sessions</h2>
          <div className={training.history}>
            {earlier.map((s, i) => (
              <div key={`${s.week_number}-${i}`} className={training.historyItem}>
                <div className={training.historyWhen}>
                  {s.live_call_at ? formatWhen(s.live_call_at) : `Session ${s.week_number}`}
                </div>
                {s.training_routine ? (
                  <div className={training.block}>
                    <span className={training.blockLabel}>Routine</span>
                    <p className={training.body}>{s.training_routine}</p>
                  </div>
                ) : null}
                {s.coach_note ? (
                  <div className={training.blockQuiet}>
                    <span className={training.blockLabelQuiet}>What Tim said</span>
                    <p className={training.body}>{s.coach_note}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className={training.parentNote}>
        Your parent can see all of this too.
      </p>
    </div>
  );
}
