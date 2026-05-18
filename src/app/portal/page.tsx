// /portal — parent dashboard, trial state.
//
// Server Component. Auth + role gate happens here:
//   * unauthenticated visitor       -> /login?next=/portal
//   * authed user with a parent row -> render the dashboard
//   * authed user that is a player  -> /play (this is them on the wrong tab)
//   * authed user that is a coach   -> /admin (also wrong tab; 404 today)
//   * authed user with no role row  -> /login (their session is orphaned)
//
// The page is intentionally calm and informational — parent isn't a player
// (Design system & PWA section of CLAUDE.md). No XP bar, no rarity badges,
// no sound toggles. Tone matches branded transactional email: dark bg,
// lime accents, Inter body.
//
// What's deliberately empty in trial state:
//   * Billing / Call recordings / Message audit panels render with the
//     shape they'll have post-conversion, but with explicit empty-state
//     copy ("nothing here yet"). CLAUDE.md: "Empty state intentionally
//     shows what *will* be there so it feels familiar when it fills in."
//   * Cancel trial CTA is rendered but inert pending the real backend
//     flow. Same posture as the nudge buttons.
//
// What's NOT here yet (open follow-ups documented in CLAUDE.md):
//   * The live trial-call date. We don't store the Calendly event URI on
//     the subscription yet, so the "Free call scheduled" card points the
//     parent at their Calendly confirmation email rather than re-rendering
//     date/time/reschedule inline.
//   * The /api/portal/nudge endpoint. The buttons render with an inert
//     "coming soon" client toast.
//   * A real cancel-trial flow. Trial cancellation is a multi-step backend
//     dance (Calendly event cancel + subscriptions.status='canceled' + auth
//     user cleanup) and warrants its own task.

import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton, NudgeButton, SendPlayerLinkButton, ManagePaymentButton } from "./PortalClient";
import MessageThread from "@/components/MessageThread";

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}
import styles from "./page.module.css";

// next/navigation's redirect is typedRoutes-aware. Several targets here
// include query strings or point at routes that don't exist yet (/play,
// /admin), neither of which is in the generated Route union. Use a
// string-typed wrapper so control flow narrowing still sees the `never`
// return.
function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  // _redirect throws internally; this satisfies TS's reachability check.
  throw new Error("redirect did not throw");
}

export const dynamic = "force-dynamic";

type QuestKey = "signup" | "drop_vod" | "answer_questions" | "join_discord";

type QuestRow = {
  key: QuestKey;
  label: string;
  parentBlurb: string;
  doneLabel: string;
};

const QUESTS: QuestRow[] = [
  {
    key: "signup",
    label: "Sign up",
    parentBlurb: "Completed when the free call was booked.",
    doneLabel: "Done at booking",
  },
  {
    key: "drop_vod",
    label: "Drop a VOD",
    parentBlurb: "A clip from a recent ranked game. Tim watches it before the call.",
    doneLabel: "VOD shared with Tim",
  },
  {
    key: "answer_questions",
    label: "Answer 3 quick questions",
    parentBlurb: "Two taps and a short reflection. About 2 minutes.",
    doneLabel: "Answered",
  },
  {
    key: "join_discord",
    label: "Join Tim's Discord",
    parentBlurb: "Where the call happens. Your child uses the Discord username on file.",
    doneLabel: "In the server",
  },
];

// @supabase/ssr 0.5's chained .select().eq().maybeSingle() doesn't always
// propagate the Database generic through to the returned row type; the
// chain falls back to `never` on some shapes. Declaring the expected row
// shapes and casting at the boundary is the standard escape hatch. The
// runtime payloads match these shapes by construction (the columns are
// in the schema; RLS filters which rows we see, not which columns).
type ParentLookup = { first_name: string; email: string; family_id: string };
type PlayerLookup = { id: string; first_name: string; discord_username: string | null };
type SubscriptionLookup = { tier: string; status: string };
type QuestLookup = { quest_key: string; completed_at: string };
type IdLookup = { id: string };

export default async function PortalPage() {
  const supabase = await createClient();

  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) redirect("/login?next=/portal");

  // Parent row is the source of truth for "this auth user is a parent."
  const parentRow = await supabase
    .from("parents")
    .select("first_name, email, family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (parentRow.error) {
    console.error("[portal] parent lookup failed", parentRow.error);
    redirect("/login?error=portal_lookup");
  }

  const parent = parentRow.data as ParentLookup | null;
  if (!parent) {
    // Could be a player or a coach on the wrong route.
    const playerRow = await supabase
      .from("players")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((playerRow.data as IdLookup | null)?.id) redirect("/play");

    const coachRow = await supabase
      .from("coaches")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((coachRow.data as IdLookup | null)?.id) redirect("/admin");

    // Orphan auth user. Bounce to login.
    redirect("/login?error=no_role");
  }

  // Oldest player wins for MVP (1-kid families). Multi-kid families will
  // need a kid selector in the nav (deferred per CLAUDE.md spec).
  const playerLookupRaw = await supabase
    .from("players")
    .select("id, first_name, discord_username")
    .eq("family_id", parent.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const player = playerLookupRaw.data as PlayerLookup | null;
  if (playerLookupRaw.error || !player) {
    console.error("[portal] player lookup failed", playerLookupRaw.error);
    redirect("/login?error=portal_player");
  }

  const [subscriptionLookup, questLookup, messageLookup, pendingCurriculumLookup, activeCurriculumLookup] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("tier, status, cycle_started_at, cycle_lessons_delivered, cycle_cancels_used")
      .eq("player_id", player.id)
      .maybeSingle(),
    supabase
      .from("quest_completions")
      .select("quest_key, completed_at")
      .eq("player_id", player.id),
    supabase
      .from("messages")
      .select("id, sender_role, body, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: true })
      .limit(100),
    supabase
      .from("curricula")
      .select("approval_token, personalization_note")
      .eq("player_id", player.id)
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("curricula")
      .select("id, personalization_note")
      .eq("player_id", player.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const subscription = subscriptionLookup.data as
    | {
        tier: string;
        status: string;
        cycle_started_at: string | null;
        cycle_lessons_delivered: number;
        cycle_cancels_used: number;
      }
    | null;
  const questRows = (questLookup.data ?? []) as QuestLookup[];
  const completedQuestKeys = new Set<string>(questRows.map((row) => row.quest_key));
  const completedCount = QUESTS.filter((q) => completedQuestKeys.has(q.key)).length;
  const messages = (messageLookup.data ?? []) as Array<{
    id: string;
    sender_role: "coach" | "player" | "bot";
    body: string;
    created_at: string;
  }>;
  const pendingCurriculum = pendingCurriculumLookup.data as
    | { approval_token: string; personalization_note: string | null }
    | null;
  const activeCurriculum = activeCurriculumLookup.data as
    | { id: string; personalization_note: string | null }
    | null;

  // Active-state curriculum weeks (slots + lesson translation).
  type SlotWithLesson = {
    week_number: number;
    is_vod_review: boolean;
    fortnite_label: string | null;
    parent_label: string | null;
    parent_skill_description: string | null;
  };
  let curriculumWeeks: SlotWithLesson[] = [];
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
        ? await supabase
            .from("lessons")
            .select("id, fortnite_label, parent_label, parent_skill_description")
            .in("id", lessonIds)
        : { data: [] };
    const lessonsById = new Map<
      string,
      { fortnite_label: string; parent_label: string; parent_skill_description: string }
    >();
    for (const l of (lessonLookup.data ?? []) as Array<{
      id: string;
      fortnite_label: string;
      parent_label: string;
      parent_skill_description: string;
    }>) {
      lessonsById.set(l.id, {
        fortnite_label: l.fortnite_label,
        parent_label: l.parent_label,
        parent_skill_description: l.parent_skill_description,
      });
    }
    curriculumWeeks = slots.map((s) => {
      const lesson = s.lesson_id ? lessonsById.get(s.lesson_id) ?? null : null;
      return {
        week_number: s.week_number,
        is_vod_review: s.is_vod_review,
        fortnite_label: lesson?.fortnite_label ?? null,
        parent_label: lesson?.parent_label ?? null,
        parent_skill_description: lesson?.parent_skill_description ?? null,
      };
    });
  }
  const isActive = subscription?.status === "active";

  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <header className={styles.topBar}>
          <div className={styles.brand}>XPL KEYED</div>
          <SignOutButton />
        </header>

        <section className={styles.hero}>
          <div className={styles.heroEyebrow}>
            {isActive ? "Parent dashboard. Active." : "Parent dashboard. Trial."}
          </div>
          <h1 className={styles.heroTitle}>
            Welcome, {parent.first_name}.
          </h1>
          <p className={styles.heroBody}>
            {isActive
              ? `${player.first_name}'s lessons are running. Cycle counter, billing, and messages with Tim are below.`
              : `${player.first_name}'s free trial is in motion. Here is everything you need before the call.`}
          </p>
        </section>

        {subscription?.status === "active" ? (
          <section className={styles.activeBanner}>
            <div className={styles.activeBannerEyebrow}>Subscription active</div>
            <h2 className={styles.curriculumBannerTitle}>
              {player.first_name} is in
            </h2>
            <p className={styles.cardBody}>
              Tim starts your first lesson cycle this Sunday. Lessons drop weekly.
              Manage payment and cancel anytime from your dashboard.
            </p>
          </section>
        ) : pendingCurriculum ? (
          <section className={styles.curriculumBanner}>
            <div className={styles.curriculumBannerEyebrow}>Curriculum ready for review</div>
            <h2 className={styles.curriculumBannerTitle}>
              Tim drafted {player.first_name}&apos;s 4 week plan
            </h2>
            <p className={styles.cardBody}>
              Open the link below to see what Tim has in mind for {player.first_name}.
              You can approve and subscribe from there.
            </p>
            <a
              href={`/curriculum/${pendingCurriculum.approval_token}`}
              className={styles.curriculumBannerCta}
            >
              Review the plan
            </a>
          </section>
        ) : null}

        {isActive ? (
          <>
            <section className={styles.card}>
              <div className={styles.cardEyebrow}>This cycle</div>
              <h2 className={styles.cardTitle}>
                Lesson {subscription?.cycle_lessons_delivered ?? 0} of 4
              </h2>
              <p className={styles.cardBody}>
                One lesson drops every Sunday. {subscription && subscription.cycle_cancels_used > 0
                  ? `Cancellations used this cycle: ${subscription.cycle_cancels_used} of 2.`
                  : "You haven't used any of your 2 cancellations this cycle."}
              </p>
              {subscription?.cycle_started_at ? (
                <p className={styles.subtle}>
                  Cycle started {formatShortDate(subscription.cycle_started_at)}.
                </p>
              ) : null}
            </section>

            {curriculumWeeks.length === 4 ? (
              <section className={styles.card}>
                <div className={styles.cardEyebrow}>{player.first_name}&apos;s 4 week plan</div>
                <h2 className={styles.cardTitle}>What Tim is working on</h2>
                {activeCurriculum?.personalization_note ? (
                  <p className={styles.cardBody}>
                    <strong>Tim&apos;s note: </strong>{activeCurriculum.personalization_note}
                  </p>
                ) : null}
                <ul className={styles.curriculumList}>
                  {curriculumWeeks.map((w) => (
                    <li key={w.week_number} className={styles.curriculumWeek}>
                      <span className={styles.curriculumWeekNum}>Week {w.week_number}</span>
                      <span className={styles.curriculumWeekCopy}>
                        {w.is_vod_review
                          ? `Review and break down ${player.first_name}'s game clip together.`
                          : (w.parent_skill_description ?? w.parent_label ?? "Lesson coming")}
                        <em className={styles.curriculumWeekTerm}>
                          {" "}(Fortnite term: {w.is_vod_review ? "VOD review" : (w.fortnite_label ?? "lesson")}.)
                        </em>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
        <>
        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Free call scheduled</div>
          <h2 className={styles.cardTitle}>You are booked</h2>
          <p className={styles.cardBody}>
            Your Calendly confirmation email has the date, time, and the link to
            reschedule or cancel. Look for it from Calendly with subject &quot;New event:
            30 minute free intro call.&quot;
          </p>
          <p className={styles.subtle}>
            The call happens on Discord, not by phone. Tim will send the invite to{" "}
            {player.first_name}
            {player.discord_username ? ` (${player.discord_username})` : ""}{" "}
            before the call.
          </p>
        </section>

        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Player access</div>
          <h2 className={styles.cardTitle}>Get {player.first_name} into the player view</h2>
          <p className={styles.cardBody}>
            {player.first_name}&apos;s sign in link will be sent to your email, not theirs.
            Click the button below to send it, then forward the email or hand them the device when you&apos;re ready.
          </p>
          <p className={styles.subtle}>
            You&apos;ll only need to do this once. {player.first_name} will stay signed in for 30 days as long as the browser isn&apos;t reset or cleared.
          </p>
          <SendPlayerLinkButton
            kidFirstName={player.first_name}
            parentEmail={parent.email}
          />
        </section>

        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Prep checklist</div>
          <h2 className={styles.cardTitle}>
            {player.first_name}&apos;s progress
            <span className={styles.progressPill}>{completedCount} of {QUESTS.length}</span>
          </h2>
          <p className={styles.cardBody}>
            These are the four quests {player.first_name} sees in the player view.{" "}
            {player.first_name} uploads a recorded clip from a recent Fortnite game and Tim watches it to get ready for the call. {player.first_name} knows what this is. It's called a VOD, short for video on demand, and {player.first_name} sees these all the time.
          </p>
          <ul className={styles.questList}>
            {QUESTS.map((q) => {
              const done = completedQuestKeys.has(q.key);
              return (
                <li key={q.key} className={`${styles.questRow} ${done ? styles.questRowDone : ""}`}>
                  <div className={styles.questCheck} aria-hidden>
                    {done ? "✓" : ""}
                  </div>
                  <div className={styles.questCopy}>
                    <div className={styles.questLabel}>{q.label}</div>
                    <div className={styles.questBlurb}>
                      {done ? q.doneLabel : q.parentBlurb}
                    </div>
                  </div>
                  <div className={styles.questAction}>
                    {done ? null : <NudgeButton questKey={q.key} kidFirstName={player.first_name} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        </>
        )}

        <section className={styles.card}>
          <div className={styles.cardEyebrow}>Messages</div>
          <h2 className={styles.cardTitle}>Between {player.first_name} and Tim</h2>
          <p className={styles.cardBody}>
            Read only. You see every message {player.first_name} sends to Tim and
            every reply. Coaching happens here in writing and in the Discord
            coaching server, never by phone.
          </p>
          <MessageThread
            initialMessages={messages}
            viewerRole="parent"
            kidFirstName={player.first_name}
            endpoint={null}
          />
        </section>

        {isActive ? (
          <section className={styles.card}>
            <div className={styles.cardEyebrow}>Billing and recordings</div>
            <h2 className={styles.cardTitle}>Manage your subscription</h2>
            <p className={styles.cardBody}>
              Update your card, see past invoices, or cancel the subscription
              in the Stripe customer portal. Cancel anytime. Your account and
              messages stay open if you do.
            </p>
            <ManagePaymentButton />
            <div className={styles.controlsGrid}>
              <div className={styles.controlCard}>
                <div className={styles.controlTitle}>Call recordings</div>
                <div className={styles.controlEmpty}>
                  Tim records every paid call. They show up here after he
                  uploads them.
                </div>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className={styles.card}>
              <div className={styles.cardEyebrow}>What to expect</div>
              <h2 className={styles.cardTitle}>The 30 minute call</h2>
              <ul className={styles.bullets}>
                <li>30 minutes on Discord voice. No phone calls, ever.</li>
                <li>Tim watches the VOD beforehand so the time is spent coaching, not scrolling.</li>
                <li>No charge unless you decide to subscribe after.</li>
                <li>If you subscribe, it is $56 for 4 lessons (one per week). Cancel the subscription any time.</li>
                <li>Cancel a paid lesson more than 24 hours out and the cycle pauses one week, full credit.</li>
                <li>Up to 2 cancellations per 4 lesson cycle. A 3rd cancel ends the subscription.</li>
                <li>All Discord coaching happens in a private channel for your family. You are invited as an observer.</li>
              </ul>
            </section>

            <section className={styles.card}>
              <div className={styles.cardEyebrow}>Your controls</div>
              <h2 className={styles.cardTitle}>Available after conversion</h2>
              <p className={styles.cardBody}>
                These panels light up the moment a paid cycle starts. Showing them
                now so you know where to find them.
              </p>
              <div className={styles.controlsGrid}>
                <div className={styles.controlCard}>
                  <div className={styles.controlTitle}>Billing</div>
                  <div className={styles.controlEmpty}>No charges yet.</div>
                </div>
                <div className={styles.controlCard}>
                  <div className={styles.controlTitle}>Call recordings</div>
                  <div className={styles.controlEmpty}>Tim records every paid call. Trial calls are not recorded.</div>
                </div>
              </div>
              {subscription?.status === "trial" ? (
                <div className={styles.trailing}>
                  <button type="button" className={styles.tertiaryBtn} disabled title="Coming soon">
                    Cancel trial
                  </button>
                  <span className={styles.subtle}>Cancel through Calendly for now. Direct cancel lands next phase.</span>
                </div>
              ) : null}
            </section>
          </>
        )}

        <section className={styles.contact}>
          <div className={styles.contactInner}>
            <div>
              <div className={styles.contactEyebrow}>Questions before the call?</div>
              <div className={styles.contactBody}>
                Have {player.first_name} message Tim in the Messages panel above.
                Tim sees it on his end and replies there. Everything stays in
                your dashboard.
              </div>
            </div>
          </div>
        </section>

        <footer className={styles.footer}>
          Signed in as {parent.email}. Bookmark this page so you can return any time.
        </footer>
      </div>
    </div>
  );
}
