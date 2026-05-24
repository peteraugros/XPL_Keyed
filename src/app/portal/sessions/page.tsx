// /portal/sessions
//
// Phase 2 scheduler + payment surface. Replaces the stub.
//
// Branches by lifecycle_state on the family's subscription:
//   ACCEPTED_PENDING_SCHEDULING / SCHEDULING_IN_PROGRESS -> SchedulerWizard
//   PENDING_PAYMENT                                       -> PaymentSummary
//   ACTIVE                                                -> SessionManagement (phase 3)
//   other                                                 -> NotReady
//
// Strict weekly sequencing (locked spec decision 1). Only one Calendly
// embed is shown at a time, targeting the next pending slot. Future
// slots render as locked rows below.

import { requireParentSession } from "../_lib/session";
import SchedulerWizard from "./SchedulerWizard";
import PaymentSummary from "./PaymentSummary";
import ActiveCycleManager from "./ActiveCycleManager";
import SingleSessionScheduler from "./SingleSessionScheduler";
import styles from "./sessions.module.css";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SubLookup = {
  id: string;
  status: string;
  tier: string | null;
  lifecycle_state: string;
  cycle_cancels_used: number;
  cycle_skips_used: number;
  auto_renew_enabled: boolean;
  trial_call_at: string | null;
};

import { formatCompactDate, formatTime } from "@/lib/datetime";

// Structured date / time / duration formatter for trial + paid sessions.
// Pinned to Pacific Time to match Calendly + emails.
function formatSessionMeta(iso: string, durationMinutes = 30) {
  return {
    date: formatCompactDate(iso) ?? "",
    time: formatTime(iso),
    duration: `${durationMinutes} min`,
  };
}
type CurriculumLookup = {
  id: string;
  personalization_note: string | null;
  cycle_anchor_at: string | null;
};
type SlotLookup = {
  id: string;
  week_number: number;
  is_vod_review: boolean;
  lesson_id: string | null;
  live_call_at: string | null;
  live_call_event_id: string | null;
  live_call_completed_at: string | null;
  no_show_at: string | null;
};
type LessonLookup = {
  id: string;
  fortnite_label: string;
  parent_label: string;
  parent_skill_description: string;
};

// "Repeat at this time" computes the expected datetime for week N as
// cycle_anchor_at + (N - 1) * 7 days, in the local timezone of the
// anchor. Returns ISO of the predicted slot so the wizard can format
// the label + pre-navigate Calendly to the matching month + date.
function computeExpectedDateTime(
  anchorIso: string,
  weekNumber: number,
): string {
  const anchor = new Date(anchorIso);
  return new Date(
    anchor.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export default async function SessionsPage() {
  const { supabase, parent, player } = await requireParentSession();

  const subResp = await supabase
    .from("subscriptions")
    .select(
      "id, status, tier, lifecycle_state, cycle_cancels_used, cycle_skips_used, auto_renew_enabled, trial_call_at",
    )
    .eq("player_id", player.id)
    .maybeSingle();
  const sub = subResp.data as SubLookup | null;

  // Find the most recent curriculum the family is working through. In the
  // new flow it's pending_approval until payment; in the legacy flow it's
  // active immediately after Stripe.
  const curriculumResp = await supabase
    .from("curricula")
    .select("id, personalization_note, cycle_anchor_at")
    .eq("player_id", player.id)
    .in("status", ["pending_approval", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curriculum = curriculumResp.data as CurriculumLookup | null;

  let slots: SlotLookup[] = [];
  const lessonsById = new Map<string, LessonLookup>();
  if (curriculum) {
    const slotResp = await supabase
      .from("curriculum_slots")
      .select(
        "id, week_number, is_vod_review, lesson_id, live_call_at, live_call_event_id, live_call_completed_at, no_show_at",
      )
      .eq("curriculum_id", curriculum.id)
      .order("week_number", { ascending: true });
    slots = (slotResp.data ?? []) as SlotLookup[];

    const lessonIds = slots.map((s) => s.lesson_id).filter((id): id is string => !!id);
    if (lessonIds.length > 0) {
      const lessonResp = await supabase
        .from("lessons")
        .select("id, fortnite_label, parent_label, parent_skill_description")
        .in("id", lessonIds);
      for (const l of (lessonResp.data ?? []) as LessonLookup[]) {
        lessonsById.set(l.id, l);
      }
    }
  }

  const lifecycle = sub?.lifecycle_state ?? "TRIAL_PREP";
  const isSingleSession = sub?.tier === "single_lesson";
  // Single-session bypasses the cycle's lifecycle gating. Anything after
  // payment (SCHEDULING_IN_PROGRESS or ACTIVE) renders SingleSessionScheduler,
  // and it self-branches on the slot's live_call_at + completed flags.
  const inScheduler =
    !isSingleSession &&
    (lifecycle === "ACCEPTED_PENDING_SCHEDULING" || lifecycle === "SCHEDULING_IN_PROGRESS");
  const inPayment = !isSingleSession && lifecycle === "PENDING_PAYMENT";
  const isActive = !isSingleSession && lifecycle === "ACTIVE";

  const slotsForClient = slots.map((s) => {
    const lesson = s.lesson_id ? lessonsById.get(s.lesson_id) ?? null : null;
    return {
      id: s.id,
      week_number: s.week_number,
      is_vod_review: s.is_vod_review,
      live_call_at: s.live_call_at,
      live_call_event_id: s.live_call_event_id,
      fortnite_label: lesson?.fortnite_label ?? null,
      parent_label: lesson?.parent_label ?? null,
      parent_skill_description: lesson?.parent_skill_description ?? null,
    };
  });

  // "Repeat at this time" suggestion: when cycle_anchor_at is set (i.e.,
  // the parent already booked at least one slot), compute the expected
  // datetime for the NEXT pending week. Used to label the toggle button
  // and to pre-navigate the Calendly embed when repeat mode is on.
  const nextPendingSlot = slotsForClient.find((s) => !s.live_call_at) ?? null;
  const suggestedDateTime =
    curriculum?.cycle_anchor_at && nextPendingSlot
      ? computeExpectedDateTime(curriculum.cycle_anchor_at, nextPendingSlot.week_number)
      : null;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Program</div>
        <h1 className={styles.title}>Sessions</h1>
      </section>

      {isSingleSession && curriculum && slots[0] ? (
        <SingleSessionScheduler
          parentFirstName={parent.first_name}
          parentEmail={parent.email}
          kidFirstName={player.first_name}
          kidDiscord={player.discord_username}
          scheduledAt={slots[0].live_call_at}
          completed={
            !!(slots[0].live_call_completed_at || slots[0].no_show_at)
          }
          intakeNote={curriculum.personalization_note}
        />
      ) : null}

      {inScheduler && curriculum ? (
        <SchedulerWizard
          parentFirstName={parent.first_name}
          kidFirstName={player.first_name}
          kidDiscord={player.discord_username}
          parentEmail={parent.email}
          curriculumId={curriculum.id}
          slots={slotsForClient}
          cycleAnchorAt={curriculum.cycle_anchor_at}
          suggestedDateTime={suggestedDateTime}
        />
      ) : null}

      {inPayment && curriculum ? (
        <PaymentSummary
          kidFirstName={player.first_name}
          slots={slotsForClient}
          curriculumId={curriculum.id}
          subscriptionId={sub!.id}
        />
      ) : null}

      {isActive && curriculum ? (
        <ActiveCycleManager
          parentFirstName={parent.first_name}
          parentEmail={parent.email}
          kidFirstName={player.first_name}
          kidDiscord={player.discord_username}
          slots={slotsForClient}
          skipsUsed={sub?.cycle_skips_used ?? 0}
          autoRenewEnabled={sub?.auto_renew_enabled ?? true}
        />
      ) : null}

      {!isSingleSession && !inScheduler && !inPayment && !isActive ? (
        sub?.trial_call_at ? (
          (() => {
            const meta = formatSessionMeta(sub.trial_call_at, 30);
            return (
              <section className={styles.card}>
                <div className={styles.cardEyebrow}>Free intro call</div>
                <h2 className={styles.cardTitle}>
                  {player.first_name}&apos;s call with Tim
                </h2>
                <div className={styles.metaRow}>
                  <div className={styles.metaBlock}>
                    <span className={styles.metaLabel}>Date</span>
                    <span className={styles.metaValue}>{meta.date}</span>
                  </div>
                  <div className={styles.metaBlock}>
                    <span className={styles.metaLabel}>Time</span>
                    <span className={styles.metaValue}>{meta.time}</span>
                  </div>
                  <div className={styles.metaBlock}>
                    <span className={styles.metaLabel}>Duration</span>
                    <span className={styles.metaValue}>{meta.duration}</span>
                  </div>
                </div>
                <p className={styles.body}>
                  The call happens on Discord. Tim sends {player.first_name} an
                  invite to {player.discord_username ?? "their Discord"}{" "}
                  beforehand. No payment today. After the call, if Tim takes
                  {" "}{player.first_name} on, you&apos;ll receive an acceptance
                  email and the 4 week plan to approve.
                </p>
                <Link href={"/portal" as never} className={styles.linkBtn}>
                  Back to overview
                </Link>
              </section>
            );
          })()
        ) : (
          <section className={styles.card}>
            <div className={styles.cardEyebrow}>Not ready yet</div>
            <h2 className={styles.cardTitle}>Sessions open after you approve the plan</h2>
            <p className={styles.body}>
              Tim drafts the curriculum after the free trial call. The
              approval email lands in your inbox. Open it to start scheduling.
            </p>
            <Link href={"/portal" as never} className={styles.linkBtn}>
              Back to overview
            </Link>
          </section>
        )
      ) : null}

    </div>
  );
}
