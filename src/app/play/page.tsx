// /play — kid's gamified quest log. Trial state.
//
// Server Component handles auth + role gating + data fetch only. All the
// interactive surface lives in PlayClient since the kid is filling out
// forms, advancing levels, and we need optimistic state.
//
// Role gate (mirror of /portal):
//   * unauthenticated         -> /login?next=/play
//   * authed player row       -> render
//   * authed parent row       -> /portal (wrong tab)
//   * authed coach row        -> /admin
//   * no role row             -> /login (orphan session)
//
// Trial state today means we always render the 4-quest log. After Stage C
// conversion this same URL needs to flip to the active-player view (lesson
// library + countdown to next Sunday + parent talking points). Branching
// on subscription.status is the natural extension and is deferred until
// the lesson surface is built.

import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PlayClient from "./PlayClient";
import styles from "./page.module.css";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

export const dynamic = "force-dynamic";

type PlayerLookup = {
  id: string;
  first_name: string;
  family_id: string;
  fortnite_username: string | null;
};
type QuestLookup = { quest_key: string };
type VodLookup = { url: string };
type PrepLookup = {
  q1_choice: string;
  q1_other_text: string | null;
  q2_choice: string;
  q2_other_text: string | null;
  q3_reflection: string;
};
type IdLookup = { id: string };

export default async function PlayPage() {
  const supabase = await createClient();

  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) redirect("/login?next=/play");

  // Player row is the source of truth for "this auth user is a player."
  const playerRow = await supabase
    .from("players")
    .select("id, first_name, family_id, fortnite_username")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (playerRow.error) {
    console.error("[play] player lookup failed", playerRow.error);
    redirect("/login?error=play_lookup");
  }

  const player = playerRow.data as PlayerLookup | null;
  if (!player) {
    // Wrong tab. Same checks as /portal but inverted.
    const parentRow = await supabase
      .from("parents")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((parentRow.data as IdLookup | null)?.id) redirect("/portal");

    const coachRow = await supabase
      .from("coaches")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((coachRow.data as IdLookup | null)?.id) redirect("/admin");

    redirect("/login?error=no_role");
  }

  const [questLookup, vodLookup, prepLookup, messageLookup, subscriptionLookup, activeCurriculumLookup] = await Promise.all([
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
      .from("messages")
      .select("id, sender_role, body, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: true })
      .limit(100),
    supabase
      .from("subscriptions")
      .select("status, cycle_lessons_delivered, cycle_started_at")
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
  const messages = (messageLookup.data ?? []) as Array<{
    id: string;
    sender_role: "coach" | "player" | "bot";
    body: string;
    created_at: string;
  }>;
  const subscription = subscriptionLookup.data as
    | { status: string; cycle_lessons_delivered: number; cycle_started_at: string | null }
    | null;
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
    <div className={styles.shell}>
      <PlayClient
        playerFirstName={player.first_name}
        fortniteUsername={player.fortnite_username}
        initialCompletedQuests={Array.from(completed)}
        initialVodUrl={vod?.url ?? null}
        initialMessages={messages}
        subscriptionStatus={subscription?.status ?? "trial"}
        cycleLessonsDelivered={subscription?.cycle_lessons_delivered ?? 0}
        curriculumWeeks={curriculumWeeks}
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
    </div>
  );
}
