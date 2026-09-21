// /curriculum/[token]
//
// Magic-link landing for the parent's curriculum review + approval.
// The link is in the conversion email Tim sends from /admin via the
// take-on endpoint. Token is the curriculum.approval_token; it lookups
// via the service-role client (this page is public — no auth required,
// possession of the token is the gate).
//
// Renders what the parent is buying + Tim's personalization note + a
// single approve-and-subscribe CTA.
//
// It USED to render a 4 week content plan, one row per week with a lesson
// title and its Hard rule #4 translation. There is no plan to preview any
// more: what a session covers is decided on the call, so the page describes
// the shape of the coaching instead. Hard rule #4 is easier here than it was,
// because describing calls and a routine needs no Fortnite vocabulary at all.

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
      .select("week_number")
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
        <div className={styles.brand}>LATE GAME ACADEMY</div>

        {curriculum.status === "active" ? (
          <div className={styles.card}>
            <h1 className={styles.headline}>You're all set</h1>
            <p className={styles.body}>
              You already approved this. Sign in to your dashboard for the
              live progress.
            </p>
            <a href="/portal" className={styles.primaryBtn}>Open your dashboard</a>
          </div>
        ) : (
          <div className={styles.card}>
            <div className={styles.eyebrow}>{player.first_name}&apos;s coaching</div>
            <h1 className={styles.headline}>Tim wants to coach {player.first_name}</h1>
            <p className={styles.body}>
              Hi {parent.first_name}. Here is the deal.
            </p>

            {/* The sell + CTA up top — that's the action the parent
                came here to take. The detail is below it, and never
                blocks reaching the button. */}
            <div className={styles.terms}>
              <p>
                <strong>$56 for 4 coaching sessions</strong> (one per week).
                Cancel the subscription any time.
              </p>
              <p className={styles.termsSubtle}>
                Cancel a session more than 24 hours out and the cycle pauses
                one week, full credit. Up to 2 cancellations per 4 session
                cycle. A 3rd cancel ends the subscription.
              </p>
            </div>

            <ApproveButton token={token} />

            {curriculum.personalization_note ? (
              <div className={styles.note}>
                <div className={styles.noteLabel}>Tim&apos;s note</div>
                <div className={styles.noteBody}>{curriculum.personalization_note}</div>
              </div>
            ) : null}

            <div className={styles.detailHeader}>
              What {slots.length === 1 ? "the session" : `the ${slots.length} sessions`} look like
            </div>
            <ul className={styles.weekList}>
              <li className={styles.weekRow}>
                <div className={styles.weekNum}>Call</div>
                <div className={styles.weekCopy}>
                  <div className={styles.weekSkill}>
                    Thirty minutes with Tim on Discord, one a week. You are
                    welcome to listen in.
                  </div>
                </div>
              </li>
              <li className={styles.weekRow}>
                <div className={styles.weekNum}>Advice</div>
                <div className={styles.weekCopy}>
                  <div className={styles.weekSkill}>
                    After each call Tim writes {player.first_name} personal
                    advice on what to change, in their own language.
                  </div>
                </div>
              </li>
              <li className={styles.weekRow}>
                <div className={styles.weekNum}>Routine</div>
                <div className={styles.weekCopy}>
                  <div className={styles.weekSkill}>
                    A specific training routine to work through before the next
                    call, so the week in between counts.
                  </div>
                </div>
              </li>
              <li className={styles.weekRow}>
                <div className={styles.weekNum}>Summary</div>
                <div className={styles.weekCopy}>
                  <div className={styles.weekSkill}>
                    A plain summary for you of what each session worked on and
                    why, without the game jargon.
                  </div>
                </div>
              </li>
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
        <div className={styles.brand}>LATE GAME ACADEMY</div>
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
