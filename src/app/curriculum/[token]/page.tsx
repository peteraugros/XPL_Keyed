// /curriculum/[token]
//
// Magic-link landing for the parent's curriculum review + approval.
// The link is in the conversion email Tim sends from /admin via the
// take-on endpoint. Token is the curriculum.approval_token; it lookups
// via the service-role client (this page is public — no auth required,
// possession of the token is the gate).
//
// Renders the 4 week plan in the parent-translation rule (real-world
// skill first, Fortnite term in italicized parens) + Tim's
// personalization note + a single "Approve plan and subscribe" CTA.
//
// **Phase 1: the Stripe Elements checkout is NOT wired.** Clicking the
// approve button shows a "Coming next phase" placeholder. Parent has
// the preview; the actual payment lands in the Stripe Elements phase.

import { createServiceRoleClient } from "@/lib/supabase/server";
import styles from "./page.module.css";
import ApproveButton from "./ApproveButton";

export const dynamic = "force-dynamic";

type CurriculumLookup = {
  id: string;
  status: string;
  personalization_note: string | null;
  approved_at: string | null;
  player_id: string;
};

type SlotLookup = {
  week_number: number;
  is_vod_review: boolean;
  lesson_id: string | null;
  vod_url: string | null;
};

type LessonLookup = {
  id: string;
  fortnite_label: string;
  parent_label: string;
  parent_skill_description: string;
};

type PlayerLookup = {
  id: string;
  first_name: string;
  family_id: string;
};

type ParentLookup = { first_name: string };

export default async function CurriculumApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!token || token.length < 32) {
    return <NotFound />;
  }

  // Service-role client — this page is reached by an unauthenticated parent
  // clicking the link in their conversion email. Possession of the token
  // is the gate; nothing else is exposed.
  const supabase = createServiceRoleClient();

  const curriculumLookup = await supabase
    .from("curricula")
    .select("id, status, personalization_note, approved_at, player_id")
    .eq("approval_token", token)
    .maybeSingle();
  const curriculum = curriculumLookup.data as CurriculumLookup | null;

  if (!curriculum) return <NotFound />;

  const [slotsLookup, playerLookupRaw] = await Promise.all([
    supabase
      .from("curriculum_slots")
      .select("week_number, is_vod_review, lesson_id, vod_url")
      .eq("curriculum_id", curriculum.id)
      .order("week_number", { ascending: true }),
    supabase
      .from("players")
      .select("id, first_name, family_id")
      .eq("id", curriculum.player_id)
      .maybeSingle(),
  ]);
  const slots = (slotsLookup.data ?? []) as SlotLookup[];
  const player = playerLookupRaw.data as PlayerLookup | null;
  if (!player) return <NotFound />;

  const lessonIds = slots
    .map((s) => s.lesson_id)
    .filter((id): id is string => Boolean(id));
  const lessonLookup =
    lessonIds.length > 0
      ? await supabase
          .from("lessons")
          .select("id, fortnite_label, parent_label, parent_skill_description")
          .in("id", lessonIds)
      : { data: [] as LessonLookup[], error: null };
  const lessonsById = new Map<string, LessonLookup>();
  for (const l of (lessonLookup.data ?? []) as LessonLookup[]) lessonsById.set(l.id, l);

  const parentLookup = await supabase
    .from("parents")
    .select("first_name")
    .eq("family_id", player.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parent = (parentLookup.data as ParentLookup | null) ?? { first_name: "there" };

  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <div className={styles.brand}>XPL KEYED</div>

        {curriculum.status === "active" ? (
          <div className={styles.card}>
            <h1 className={styles.headline}>You're all set</h1>
            <p className={styles.body}>
              You already approved this curriculum. Sign in to your dashboard
              for the live progress.
            </p>
            <a href="/portal" className={styles.primaryBtn}>Open your dashboard</a>
          </div>
        ) : (
          <div className={styles.card}>
            <div className={styles.eyebrow}>{player.first_name}&apos;s 4 week plan</div>
            <h1 className={styles.headline}>Tim wants to coach {player.first_name}</h1>
            <p className={styles.body}>
              Hi {parent.first_name}. Here is the deal.
            </p>

            {/* The sell + CTA up top — that's the action the parent
                came here to take. The full 4 week plan is below for
                review but doesn't block reaching the button. */}
            <div className={styles.terms}>
              <p>
                <strong>$56 for 4 lessons</strong> (one per week). Cancel the
                subscription any time.
              </p>
              <p className={styles.termsSubtle}>
                Cancel a paid lesson more than 24 hours out and the cycle pauses
                one week, full credit. Up to 2 cancellations per 4 lesson cycle.
                A 3rd cancel ends the subscription.
              </p>
            </div>

            <ApproveButton token={token} />

            {curriculum.personalization_note ? (
              <div className={styles.note}>
                <div className={styles.noteLabel}>Tim&apos;s note</div>
                <div className={styles.noteBody}>{curriculum.personalization_note}</div>
              </div>
            ) : null}

            <div className={styles.lessonsHeader}>The 4 week plan</div>
            <ul className={styles.weekList}>
              {slots.map((slot) => {
                const lesson = slot.lesson_id ? lessonsById.get(slot.lesson_id) : null;
                const fortniteTerm = slot.is_vod_review
                  ? "VOD review"
                  : lesson?.fortnite_label ?? "Lesson";
                const skill = slot.is_vod_review
                  ? `Review and break down ${player.first_name}'s game clip together.`
                  : lesson?.parent_skill_description ??
                    lesson?.parent_label ??
                    "Skill description coming soon.";
                return (
                  <li key={slot.week_number} className={styles.weekRow}>
                    <div className={styles.weekNum}>Week {slot.week_number}</div>
                    <div className={styles.weekCopy}>
                      <div className={styles.weekSkill}>{skill}</div>
                      <div className={styles.weekTerm}>
                        <em>(Fortnite term: {fortniteTerm}.)</em>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <div className={styles.brand}>XPL KEYED</div>
        <div className={styles.card}>
          <h1 className={styles.headline}>Link not found</h1>
          <p className={styles.body}>
            This approval link is no longer valid. If you think this is a
            mistake, reply to the email Tim sent and he will resend the link.
          </p>
        </div>
      </div>
    </div>
  );
}
