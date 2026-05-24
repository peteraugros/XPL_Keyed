// /play — Kid's HQ briefing.
//
// Auth + role gate is handled by /play/layout.tsx via requirePlayerSession.
// This page just fetches HQ-specific data and hands off to PlayClient.
//
// Messages thread moved to /play/squad. Locked-library card replaced by a
// routing tile to /play/library. Footer + sign-out live in PlayShell.

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

  const [questLookup, vodLookup, prepLookup, subscriptionLookup, activeCurriculumLookup] = await Promise.all([
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
        "status, tier, cycle_lessons_delivered, cycle_started_at, trial_call_at",
      )
      .eq("player_id", player.id)
      .maybeSingle(),
    supabase
      .from("curricula")
      .select("id")
      .eq("player_id", player.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
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
        cycle_lessons_delivered: number;
        cycle_started_at: string | null;
        trial_call_at: string | null;
      }
    | null;
  const isSingleSession = subscription?.tier === "single_lesson";

  // Single-session lookup: the one assigned lesson + its video URL.
  // Drives the kid's "Coach assigned you a lesson" card. Bypasses the
  // 4-week curriculum machinery entirely.
  let singleSessionLesson: {
    fortnite_label: string;
    video_url: string | null;
    delivered_at: string | null;
    live_call_at: string | null;
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
        .select("lesson_id, live_call_at, delivered_at")
        .eq("curriculum_id", ssCurrId)
        .limit(1)
        .maybeSingle();
      const slot = slotResp.data as
        | { lesson_id: string | null; live_call_at: string | null; delivered_at: string | null }
        | null;
      if (slot?.lesson_id) {
        const lessonResp = await supabase
          .from("lessons")
          .select("fortnite_label, video_url")
          .eq("id", slot.lesson_id)
          .maybeSingle();
        const lesson = lessonResp.data as
          | { fortnite_label: string; video_url: string | null }
          | null;
        if (lesson) {
          singleSessionLesson = {
            fortnite_label: lesson.fortnite_label,
            video_url: lesson.video_url,
            delivered_at: slot.delivered_at,
            live_call_at: slot.live_call_at,
          };
        }
      } else if (slot) {
        // Lesson not assigned yet but the slot exists.
        singleSessionLesson = {
          fortnite_label: "",
          video_url: null,
          delivered_at: null,
          live_call_at: slot.live_call_at,
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
  const activeCurriculum = activeCurriculumLookup.data as { id: string } | null;

  // Fetch curriculum weeks for the kid (kid-facing labels).
  type CurriculumWeek = {
    week_number: number;
    is_vod_review: boolean;
    fortnite_label: string | null;
  };
  let curriculumWeeks: CurriculumWeek[] = [];
  if (activeCurriculum) {
    const slotLookup = await supabase
      .from("curriculum_slots")
      .select("week_number, is_vod_review, lesson_id")
      .eq("curriculum_id", activeCurriculum.id)
      .order("week_number", { ascending: true });
    const slots = (slotLookup.data ?? []) as Array<{
      week_number: number;
      is_vod_review: boolean;
      lesson_id: string | null;
    }>;
    const lessonIds = slots.map((s) => s.lesson_id).filter((id): id is string => Boolean(id));
    const lessonLookup =
      lessonIds.length > 0
        ? await supabase.from("lessons").select("id, fortnite_label").in("id", lessonIds)
        : { data: [] };
    const labelById = new Map<string, string>();
    for (const l of (lessonLookup.data ?? []) as Array<{ id: string; fortnite_label: string }>) {
      labelById.set(l.id, l.fortnite_label);
    }
    curriculumWeeks = slots.map((s) => ({
      week_number: s.week_number,
      is_vod_review: s.is_vod_review,
      fortnite_label: s.lesson_id ? labelById.get(s.lesson_id) ?? null : null,
    }));
  }

  return (
    <PlayClient
      playerFirstName={player.first_name}
      fortniteUsername={player.fortnite_username}
      initialCompletedQuests={Array.from(completed)}
      initialVodUrl={vod?.url ?? null}
      subscriptionStatus={subscription?.status ?? "trial"}
      subscriptionTier={subscription?.tier ?? null}
      cycleLessonsDelivered={subscription?.cycle_lessons_delivered ?? 0}
      curriculumWeeks={curriculumWeeks}
      trialCallAt={subscription?.trial_call_at ?? null}
      discordChannelUrl={discordChannelUrl}
      singleSessionLesson={singleSessionLesson}
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
