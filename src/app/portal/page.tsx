// /portal — Parent dashboard HOME.
//
// Briefing layout, not "the entire application." The sidebar (portal/layout.tsx)
// is the structure; deeper content lives on per section pages reachable from
// the sidebar (Progress, Sessions, Messages, Billing, etc). This page answers
// the four questions a parent walks in with:
//
//   1. Is my child doing okay?            -> hero status line
//   2. What should I pay attention to?    -> urgent alerts strip
//   3. Is there anything I need to do?    -> quick actions
//   4. Where do I go for specific things? -> 3 card summary grid + sidebar
//
// Branches on a single `phase` discriminator derived from subscription.status:
//
//   * trial          (status='trial')          — pre conversion briefing
//   * active         (status='active')         — paid cycle in progress
//   * past_due       (status='past_due')       — payment hold, cycle frozen
//   * pending_cancel (status='pending_cancel') — winding down, 7 day undo window
//   * ended          (status in canceled|declined|null) — final, soft state
//
// Undo for pending_cancel + restart for ended both point at offline paths
// (Calendly email Undo link / email Tim) because the in portal endpoints
// aren't built yet. The UI is honest about that; it doesn't render dead
// buttons.

import Link from "next/link";
import { requireParentSession } from "./_lib/session";
import { SendPlayerLinkButton, ManagePaymentButton } from "./PortalClient";
import SessionPersistenceModal from "@/components/SessionPersistenceModal";
import PaymentProcessingCard from "./PaymentProcessingCard";
import LiveSummaryCards from "./LiveSummaryCards";
import LiveOnboardingCards from "./LiveOnboardingCards";
import LiveSingleSessionCards from "./LiveSingleSessionCards";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

// Casts at the boundary to dodge @supabase/ssr 0.5's chained generic regression.
type SubLookup = {
  status: string;
  tier: string | null;
  lifecycle_state: string | null;
  cycle_lessons_delivered: number;
  cycle_cancels_used: number;
  cycle_started_at: string | null;
  pending_cancel_auto_confirm_at: string | null;
  trial_call_at: string | null;
};
type QuestRow = { quest_key: string };
type MessageRow = {
  id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
  created_at: string;
};
type PendingCurriculum = { id: string; approval_token: string };
type SlotLookup = { week_number: number; live_call_at: string | null };

// Data shape passed to LiveSummaryCards when the parent is in a
// post-acceptance lifecycle (after clicking the acceptance email,
// before payment lands). Drives the redesigned onboarding card set.
export type OnboardingCardData = {
  // Next slot the parent should care about. Prefer the earliest
  // unscheduled, then fall back to the earliest scheduled future call.
  nextSlot: SlotLookup | null;
  slotsBookedCount: number;
  totalSlots: number;
  approvalToken: string;
};

type Phase = "trial" | "active" | "past_due" | "pending_cancel" | "ended";

// Did the parent already click the acceptance email? The lifecycle
// flips from TRIAL_DONE -> ACCEPTED_PENDING_SCHEDULING on that click,
// and progresses through SCHEDULING_IN_PROGRESS / PENDING_PAYMENT
// before payment lands. Any of those count as "post-acceptance" for
// the dashboard banner.
const POST_ACCEPTANCE_LIFECYCLES = new Set([
  "ACCEPTED_PENDING_SCHEDULING",
  "SCHEDULING_IN_PROGRESS",
  "PENDING_PAYMENT",
]);
function isPostAcceptance(lifecycle: string | null): boolean {
  return lifecycle !== null && POST_ACCEPTANCE_LIFECYCLES.has(lifecycle);
}

function phaseFor(status: string | undefined): Phase {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "pending_cancel":
      return "pending_cancel";
    case "canceled":
    case "declined":
      return "ended";
    case "trial":
      return "trial";
    default:
      return "trial";
  }
}

// Datetime formatters live in src/lib/datetime.ts. Centralized there
// because Server Components default to the server's timezone (UTC on
// Railway) and we need PT consistently to match Calendly + emails.
import {
  formatShortDate as fmtShortDate,
  formatCallDateTime as fmtCallDateTime,
} from "@/lib/datetime";
const formatShortDate = fmtShortDate;
const formatCallDateTime = fmtCallDateTime;

export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; just_accepted?: string }>;
}) {
  const { welcome, just_accepted } = await searchParams;
  const showWelcome = welcome === "1";
  const justAccepted = just_accepted === "1";
  const { supabase, parent, player } = await requireParentSession();

  const [subResp, questResp, msgResp, pendingResp] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "status, tier, lifecycle_state, cycle_lessons_delivered, cycle_cancels_used, cycle_started_at, pending_cancel_auto_confirm_at, trial_call_at",
      )
      .eq("player_id", player.id)
      .maybeSingle(),
    supabase
      .from("quest_completions")
      .select("quest_key")
      .eq("player_id", player.id),
    supabase
      .from("messages")
      .select("id, sender_role, body, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("curricula")
      .select("id, approval_token")
      .eq("player_id", player.id)
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const sub = subResp.data as SubLookup | null;
  const completedQuests = ((questResp.data ?? []) as QuestRow[]).length;
  const latestMessage = ((msgResp.data ?? []) as MessageRow[])[0] ?? null;
  const pendingCurriculum = pendingResp.data as PendingCurriculum | null;

  // Post-acceptance onboarding card data. Only fetched when the
  // subscription is in one of the post-acceptance lifecycle states
  // (ACCEPTED_PENDING_SCHEDULING / SCHEDULING_IN_PROGRESS / PENDING_PAYMENT).
  // Drives the redesigned 3-card onboarding set inside LiveSummaryCards.
  let onboardingCardData: OnboardingCardData | null = null;
  if (
    isPostAcceptance(sub?.lifecycle_state ?? null) &&
    pendingCurriculum
  ) {
    const slotsLookup = await supabase
      .from("curriculum_slots")
      .select("week_number, live_call_at")
      .eq("curriculum_id", pendingCurriculum.id)
      .order("week_number", { ascending: true });
    const slots = (slotsLookup.data ?? []) as SlotLookup[];
    const slotsBookedCount = slots.filter((s) => s.live_call_at !== null).length;
    // Prefer the earliest unscheduled slot so the parent always sees the
    // "next thing to do." If everything's booked, surface the soonest
    // future call as the "next session" snapshot.
    const now = Date.now();
    const nextSlot =
      slots.find((s) => !s.live_call_at) ??
      slots.find((s) => s.live_call_at && new Date(s.live_call_at).getTime() >= now) ??
      slots[0] ??
      null;
    onboardingCardData = {
      nextSlot,
      slotsBookedCount,
      totalSlots: slots.length,
      approvalToken: pendingCurriculum.approval_token,
    };
  }

  // Week-1-delivered signal for the welcome state copy. If Week 1's
  // delivered_at is set, the parent has received the PDF today.
  // Otherwise the lesson is queued for the next Sunday.
  let week1Delivered = false;
  if (showWelcome) {
    const week1Lookup = await supabase
      .from("curriculum_slots")
      .select("delivered_at, curricula!inner(player_id, status)")
      .eq("curricula.player_id", player.id)
      .eq("curricula.status", "active")
      .eq("week_number", 1)
      .maybeSingle();
    const week1 = week1Lookup.data as { delivered_at: string | null } | null;
    week1Delivered = !!week1?.delivered_at;
  }

  // Single-session families pay $24 for one coaching call and don't have
  // a cycle, auto-renew, or Sunday lesson drops. Detect off subscription
  // tier and branch the hero + bottom cards. The cycle-subscriber UI
  // (Lesson X of 4, cancellations remaining) does not apply to them.
  const isSingleSession = sub?.tier === "single_lesson";

  let singleSessionData: {
    callAtIso: string | null;
    callCompleted: boolean;
    intakeNote: string | null;
    lessonParentLabel: string | null;
  } | null = null;
  if (isSingleSession) {
    const currResp = await supabase
      .from("curricula")
      .select("id, personalization_note")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const curr = currResp.data as
      | { id: string; personalization_note: string | null }
      | null;
    if (curr) {
      const slotResp = await supabase
        .from("curriculum_slots")
        .select("live_call_at, live_call_completed_at, no_show_at, lesson_id")
        .eq("curriculum_id", curr.id)
        .order("week_number", { ascending: true })
        .limit(1)
        .maybeSingle();
      const slot = slotResp.data as
        | {
            live_call_at: string | null;
            live_call_completed_at: string | null;
            no_show_at: string | null;
            lesson_id: string | null;
          }
        | null;
      let lessonParentLabel: string | null = null;
      if (slot?.lesson_id) {
        const lessonResp = await supabase
          .from("lessons")
          .select("parent_label")
          .eq("id", slot.lesson_id)
          .maybeSingle();
        const lesson = lessonResp.data as { parent_label: string } | null;
        lessonParentLabel = lesson?.parent_label ?? null;
      }
      singleSessionData = {
        callAtIso: slot?.live_call_at ?? null,
        callCompleted: !!(slot?.live_call_completed_at || slot?.no_show_at),
        intakeNote: curr.personalization_note,
        lessonParentLabel,
      };
    }
  }

  const phase = phaseFor(sub?.status);
  const cycleProgress = sub?.cycle_lessons_delivered ?? 0;
  const cancelsUsed = sub?.cycle_cancels_used ?? 0;
  const autoConfirmDate = formatShortDate(sub?.pending_cancel_auto_confirm_at ?? null);
  // Calendly's invitee.created webhook populates trial_call_at on the
  // subscription as soon as the parent books. NULL only in the brief
  // window before the webhook fires.
  const callDateTime = formatCallDateTime(sub?.trial_call_at ?? null);

  const singleSessionCallDateTime = formatCallDateTime(
    singleSessionData?.callAtIso ?? null,
  );

  const heroByPhase: Record<Phase, { eyebrow: string; body: string }> = {
    trial: {
      eyebrow: "Free trial",
      body: `${player.first_name}'s free intro call is on the calendar.`,
    },
    active: {
      eyebrow: "Subscription active",
      body: `${player.first_name}'s lessons are running. One drops every Sunday.`,
    },
    past_due: {
      eyebrow: "Payment hold",
      body: `${player.first_name}'s lessons are paused while we sort payment.`,
    },
    pending_cancel: {
      eyebrow: "Subscription ending",
      body: `${player.first_name}'s subscription is winding down${
        autoConfirmDate ? `. It closes on ${autoConfirmDate} unless you undo.` : "."
      }`,
    },
    ended: {
      eyebrow: "Coaching wrapped",
      body:
        sub?.status === "declined"
          ? `Tim recommended other paths after the intro call. Your account stays open.`
          : `${player.first_name}'s coaching has ended. Your account stays open. Restart any time.`,
    },
  };
  // Single-session hero overrides the cycle hero entirely. Three states
  // keyed off the slot: not scheduled / scheduled future / call complete.
  const singleSessionHero: { eyebrow: string; body: string } | null = isSingleSession
    ? {
        eyebrow: "Single session",
        body: singleSessionData?.callCompleted
          ? `${player.first_name}'s coaching session is complete. Materials are in the player view.`
          : singleSessionCallDateTime
            ? `${player.first_name}'s coaching session is on ${singleSessionCallDateTime}.`
            : `Last step: pick a time for ${player.first_name}'s coaching call.`,
      }
    : null;
  const hero = singleSessionHero ?? heroByPhase[phase];

  // The primary action varies by phase. Rendered inside the hero row at
  // desktop (right column) so it doesn't push the summary cards below
  // the fold. Falls under the hero on mobile.
  //
  // Active state intentionally has NO primary action card — the Billing
  // nav item is the canonical entry point for "manage your subscription."
  // past_due and pending_cancel keep theirs because those are urgent
  // recovery actions, not generic account management.
  const primaryAction =
    phase === "past_due" || phase === "pending_cancel" ? (
      <div className={styles.heroActionCard}>
        <div className={styles.actionsTitle}>
          {phase === "past_due"
            ? "Update your card"
            : "Manage payment"}
        </div>
        <div className={styles.actionsBody}>
          {phase === "past_due"
            ? "Open the secure Stripe portal to replace the failed card."
            : "Invoices and saved card live in Stripe. The email's Undo link is what reverts the cancel."}
        </div>
        <ManagePaymentButton />
      </div>
    ) : phase === "ended" ? (
      <div className={styles.heroActionCard}>
        <div className={styles.actionsTitle}>Pick this back up</div>
        <div className={styles.actionsBody}>
          Email Tim at <span className={styles.code}>tim@xplkeyed.com</span> to
          restart. Account and history stay put.
        </div>
      </div>
    ) : (
      <div className={styles.heroActionCard}>
        <div className={styles.actionsTitle}>
          Player sign in
        </div>
        <div className={styles.actionsBody}>
          {player.first_name}&apos;s sign in link sends to your email. Forward it or
          hand them the device. One time setup.
        </div>
        <SendPlayerLinkButton
          kidFirstName={player.first_name}
          parentEmail={parent.email}
        />
      </div>
    );

  return (
    <div className={styles.home}>
      {primaryAction ? (
        <div className={styles.heroRow}>
          <section className={styles.hero}>
            <div className={styles.heroEyebrow}>{hero.eyebrow}</div>
            <h1 className={styles.heroTitle}>Welcome back, {parent.first_name}.</h1>
            <p className={styles.heroBody}>{hero.body}</p>
          </section>
          {primaryAction}
        </div>
      ) : (
        <section className={styles.hero}>
          <div className={styles.heroEyebrow}>{hero.eyebrow}</div>
          <h1 className={styles.heroTitle}>Welcome back, {parent.first_name}.</h1>
          <p className={styles.heroBody}>{hero.body}</p>
        </section>
      )}

      {/* Post-payment "active / enrolled" celebration. Renders on the
          first /portal visit after Stripe success (success-page CTA
          links here with ?welcome=1). Confident, final language. If
          Stripe completed the redirect, the parent's card was charged;
          there is no honest "processing" state to show. The DB may
          take a beat to catch up, but we show the confident state from
          the moment they land — that's the whole UX intent. */}
      {showWelcome && phase === "active" ? (
        <section className={styles.alertCelebrate}>
          <div className={styles.alertEyebrowCelebrate}>Enrolled</div>
          <h2 className={styles.alertTitleLarge}>
            {player.first_name}&apos;s program is active
          </h2>
          <p className={styles.alertBody}>
            Your subscription is confirmed and your lessons are scheduled.{" "}
            {week1Delivered
              ? `${player.first_name}'s first PDF lesson has been delivered today.`
              : `${player.first_name}'s first PDF lesson drops this Sunday.`}
            {" "}New lessons arrive every Sunday.
          </p>
          <p className={styles.alertBody}>
            You can:
          </p>
          <ul className={styles.alertList}>
            <li>Reserve upcoming coaching sessions</li>
            <li>Track progress and lesson history</li>
            <li>Have {player.first_name} message me from the player view. You see every message here.</li>
          </ul>
          <div className={styles.alertCtaRow}>
            <Link href={"/portal/sessions" as never} className={styles.alertCta}>
              View Sessions
            </Link>
            <Link href={"/portal/messages" as never} className={styles.alertCtaSecondary}>
              View Messages
            </Link>
          </div>
        </section>
      ) : showWelcome ? (
        /* Stripe redirect landed before our webhook did — render a thin
           transitional state while the backend catches up. Client-side
           poll re-fetches the page every 2 seconds until lifecycle hits
           ACTIVE, then the enrolled banner above takes over. No
           "confirming payment" or "refresh" language. */
        <PaymentProcessingCard kidFirstName={player.first_name} />
      ) : pendingCurriculum && phase === "trial" && isPostAcceptance(sub?.lifecycle_state ?? null) ? (
        /* Post-acceptance celebration. Parent has clicked the acceptance
           email, lifecycle has transitioned (ACCEPTED_PENDING_SCHEDULING
           or beyond), but they haven't completed payment yet. Drop them
           here with congrats + clear next step instead of straight into
           the scheduler. */
        <section className={styles.alertCelebrate}>
          <div className={styles.alertEyebrowCelebrate}>
            {justAccepted ? "Congratulations" : "Onboarding"}
          </div>
          <h2 className={styles.alertTitleLarge}>
            {sub?.lifecycle_state === "PENDING_PAYMENT"
              ? `${player.first_name}'s slots are reserved`
              : "You are in."}
          </h2>
          <p className={styles.alertBody}>
            {sub?.lifecycle_state === "PENDING_PAYMENT"
              ? `All 4 lessons are on the calendar. Complete payment to lock them in.`
              : sub?.lifecycle_state === "SCHEDULING_IN_PROGRESS"
                ? `You started scheduling. Pick the remaining slots when you're ready.`
                : `Tim accepted ${player.first_name} as a student. When you're ready, book the 4 lessons. They'll run in the order you pick.`}
          </p>
          <Link
            href={"/portal/sessions" as never}
            className={styles.alertCta}
          >
            {sub?.lifecycle_state === "PENDING_PAYMENT"
              ? "Complete payment"
              : sub?.lifecycle_state === "SCHEDULING_IN_PROGRESS"
                ? "Continue scheduling"
                : "Schedule sessions"}
          </Link>
        </section>
      ) : pendingCurriculum && phase === "trial" ? (
        /* Pre-acceptance. Tim has drafted a curriculum but the parent
           hasn't clicked the acceptance email yet. Point them at the
           curriculum overview to review before kicking off scheduling. */
        <section className={styles.alertCelebrate}>
          <div className={styles.alertEyebrowCelebrate}>Congratulations</div>
          <h2 className={styles.alertTitleLarge}>You are in.</h2>
          <p className={styles.alertBody}>
            Tim accepted {player.first_name} as a student. Review the 4 week
            plan he drafted and approve to lock it in.
          </p>
          <Link
            href={`/curriculum/${pendingCurriculum.approval_token}` as never}
            className={styles.alertCta}
          >
            Review the plan
          </Link>
        </section>
      ) : null}

      {phase === "past_due" ? (
        <section className={styles.alert}>
          <div className={styles.alertEyebrow}>Payment hold</div>
          <h2 className={styles.alertTitle}>Update your card to resume lessons</h2>
          <p className={styles.alertBody}>
            The cycle is paused. No charge during the hold, no impact on your
            cancel allowance.
          </p>
          <ManagePaymentButton />
        </section>
      ) : null}

      {phase === "pending_cancel" ? (
        <section className={styles.alertWarn}>
          <div className={styles.alertEyebrow}>Winding down</div>
          <h2 className={styles.alertTitle}>
            {autoConfirmDate
              ? `Closes on ${autoConfirmDate}. Want to keep it?`
              : "Want to keep the subscription?"}
          </h2>
          <p className={styles.alertBody}>
            We sent you an email with an Undo link. Click it to revert the
            third cancel, restore your slot, and resume the cycle. No new
            lessons or charges run until you decide.
          </p>
          <p className={styles.alertSubtle}>
            Or reply to the email and Tim will sort it with you directly.
          </p>
        </section>
      ) : null}

      {phase === "ended" ? (
        <section className={styles.alertSoft}>
          <div className={styles.alertEyebrow}>Account is open</div>
          <h2 className={styles.alertTitle}>You can pick this back up</h2>
          <p className={styles.alertBody}>
            Your messages, history, and family record stay here. If you want
            to restart, email Tim and he will walk you back in.
          </p>
        </section>
      ) : null}

      {isSingleSession ? (
        <LiveSingleSessionCards
          callDateTime={singleSessionCallDateTime}
          callCompleted={singleSessionData?.callCompleted ?? false}
          intakeNote={singleSessionData?.intakeNote ?? null}
          lessonParentLabel={singleSessionData?.lessonParentLabel ?? null}
          latestMessage={latestMessage}
          playerFirstName={player.first_name}
        />
      ) : onboardingCardData ? (
        <LiveOnboardingCards
          lifecycleState={sub?.lifecycle_state ?? null}
          nextSlot={onboardingCardData.nextSlot}
          slotsBookedCount={onboardingCardData.slotsBookedCount}
          totalSlots={onboardingCardData.totalSlots}
          approvalToken={onboardingCardData.approvalToken}
          playerFirstName={player.first_name}
        />
      ) : (
        <LiveSummaryCards
          phase={phase}
          callDateTime={callDateTime}
          completedQuests={completedQuests}
          cycleProgress={cycleProgress}
          cancelsUsed={cancelsUsed}
          latestMessage={latestMessage}
          playerFirstName={player.first_name}
          playerDiscordUsername={player.discord_username ?? null}
        />
      )}

      <SessionPersistenceModal />
    </div>
  );
}
