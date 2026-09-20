// /play — Kid's HQ briefing.
//
// Auth + role gate is handled by /play/layout.tsx via requirePlayerSession.
// This page just fetches HQ-specific data and hands off to PlayClient.
//
// Messages thread moved to /play/squad. Tim's advice and training routine
// live at /play/training. Footer + sign-out live in PlayShell.

import { requirePlayerSession } from "./_lib/session";
import PlayClient from "./PlayClient";

export const dynamic = "force-dynamic";

type QuestLookup = { quest_key: string };
type VodLookup = { url: string };
type PrepLookup = {
  q1_choice: string;
  q1_other_text: string | null;
  q2_choice: string;
  q2_other_text: string | null;
  q3_reflection: string;
};

export default async function PlayHQ() {
  const { supabase, player } = await requirePlayerSession();

  const [questLookup, vodLookup, prepLookup, subscriptionLookup] = await Promise.all([
    supabase.from("quest_completions").select("quest_key").eq("player_id", player.id),
    supabase
      .from("vod_uploads")
      .select("url")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("prep_responses")
      .select("q1_choice, q1_other_text, q2_choice, q2_other_text, q3_reflection")
      .eq("player_id", player.id)
      .maybeSingle(),
    supabase
      .from("subscriptions")
      .select(
        "status, tier, cycle_sessions_delivered, cycle_started_at, trial_call_at",
      )
      .eq("player_id", player.id)
      .maybeSingle(),
  ]);

  const questRows = (questLookup.data ?? []) as QuestLookup[];
  const completed = new Set(questRows.map((q) => q.quest_key));
  const vod = vodLookup.data as VodLookup | null;
  const prep = prepLookup.data as PrepLookup | null;
  const subscription = subscriptionLookup.data as
    | {
        status: string;
        tier: string | null;
        cycle_sessions_delivered: number;
        cycle_started_at: string | null;
        trial_call_at: string | null;
      }
    | null;
  const isSingleSession = subscription?.tier === "single_lesson";

  // Single-session lookup: when the call is, and whether Tim has written
  // up the advice and routine yet. The write-up itself lives at
  // /play/training; this card only says whether there is one to go read.
  let singleSession: {
    live_call_at: string | null;
    has_write_up: boolean;
  } | null = null;
  if (isSingleSession) {
    const ssCurriculum = await supabase
      .from("curricula")
      .select("id")
      .eq("player_id", player.id)
      .eq("curriculum_type" as never, "single_session")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ssCurrId = (ssCurriculum.data as { id: string } | null)?.id;
    if (ssCurrId) {
      const slotResp = await supabase
        .from("curriculum_slots")
        .select("live_call_at, coach_note, training_routine")
        .eq("curriculum_id", ssCurrId)
        .limit(1)
        .maybeSingle();
      const slot = slotResp.data as
        | {
            live_call_at: string | null;
            coach_note: string | null;
            training_routine: string | null;
          }
        | null;
      if (slot) {
        singleSession = {
          live_call_at: slot.live_call_at,
          has_write_up: Boolean(slot.coach_note || slot.training_routine),
        };
      }
    }
  }

  // Pull the kid's private Discord channel URL so the trial-call CTA
  // can deep-link there once the call window opens.
  const playerExtra = await supabase
    .from("players")
    .select("discord_channel_url")
    .eq("id", player.id)
    .maybeSingle();
  const discordChannelUrl =
    (playerExtra.data as { discord_channel_url: string | null } | null)?.discord_channel_url ?? null;

  // Upcoming sessions for the swap control. Only sessions that have not been
  // delivered: a session Tim has written up is spent and nothing about it can
  // change. Scoped to the player's own curricula, and read through the cookie
  // session so RLS is what enforces that rather than this query remembering to.
  let upcomingSessions: {
    id: string;
    week_number: number;
    live_call_at: string | null;
    delivery_mode: string;
    vod_review_by: string | null;
    has_vod: boolean;
  }[] = [];
  let vodReviewsUsed = 0;
  {
    const curs = await supabase.from("curricula").select("id").eq("player_id", player.id);
    const ids = ((curs.data ?? []) as { id: string }[]).map((c) => c.id);
    if (ids.length > 0) {
      const resp = await supabase
        .from("curriculum_slots")
        .select("id, week_number, live_call_at, delivery_mode, vod_review_by, vod_upload_id, delivered_at")
        .in("curriculum_id", ids)
        .is("delivered_at", null)
        .order("week_number", { ascending: true });
      upcomingSessions = ((resp.data ?? []) as {
        id: string; week_number: number; live_call_at: string | null;
        delivery_mode: string; vod_review_by: string | null; vod_upload_id: string | null;
      }[]).map((r) => ({
        id: r.id,
        week_number: r.week_number,
        live_call_at: r.live_call_at,
        delivery_mode: r.delivery_mode,
        vod_review_by: r.vod_review_by,
        has_vod: r.vod_upload_id !== null,
      }));
    }
    const subExtra = await supabase
      .from("subscriptions")
      .select("cycle_vod_reviews_used")
      .eq("player_id", player.id)
      .maybeSingle();
    vodReviewsUsed =
      (subExtra.data as { cycle_vod_reviews_used: number } | null)?.cycle_vod_reviews_used ?? 0;
  }

  return (
    <PlayClient
      upcomingSessions={upcomingSessions}
      vodReviewsUsed={vodReviewsUsed}
      playerFirstName={player.first_name}
      fortniteUsername={player.fortnite_username}
      initialCompletedQuests={Array.from(completed)}
      initialVodUrl={vod?.url ?? null}
      subscriptionStatus={subscription?.status ?? "trial"}
      subscriptionTier={subscription?.tier ?? null}
      cycleSessionsDelivered={subscription?.cycle_sessions_delivered ?? 0}
      trialCallAt={subscription?.trial_call_at ?? null}
      discordChannelUrl={discordChannelUrl}
      singleSession={singleSession}
      initialPrep={
        prep
          ? {
              q1_choice: prep.q1_choice,
              q1_other_text: prep.q1_other_text,
              q2_choice: prep.q2_choice,
              q2_other_text: prep.q2_other_text,
              q3_reflection: prep.q3_reflection,
            }
          : null
      }
    />
  );
}
