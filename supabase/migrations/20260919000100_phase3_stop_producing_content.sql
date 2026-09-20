-- Phase 3 of the content-to-coaching simplification (2026-09-19).
--
-- Behavioural, not destructive. Nothing is dropped: no table, no column, no
-- code. After this migration no NEW lesson content can be created, while
-- everything that exists still reads. This is the last fully reversible point.
--
-- ---------------------------------------------------------------------------
-- 1. derived_tasks_view loses three branches
-- ---------------------------------------------------------------------------
-- Tim's Focused Home queue is this view. Three of its task types exist only to
-- chase him about content he no longer makes:
--
--   lesson_authoring_needed      "Week 3's lesson is still a stub, author the
--                                 slides + voiceover" (P75)
--   library_running_low          "Only N published lessons, author a few more"
--                                 (P22)
--   single_session_needs_lesson  "Pick a lesson from the library or build one"
--                                 (P76)
--
-- The view is re-emitted WHOLE rather than patched, because it is a single
-- CREATE OR REPLACE with UNION ALL branches and there is no way to remove one
-- in place. It was rebuilt programmatically from the definition in
-- 20260525000300_refund_requests.sql, which is the live one, with the three
-- branches removed and every other branch left byte identical. 17 branches
-- become 14.
--
-- The `next_stub_slot` CTE goes with them. It was referenced ONLY by
-- lesson_authoring_needed, and it was the only place this view joined
-- `lessons` (to count jsonb_array_length(slides)). Removing both means the
-- view no longer references the lessons table at all, which is what makes the
-- Phase 5 drop possible. Verified by assertion when this file was generated,
-- not by reading.
--
-- ⚠️ NOTE ON ORDERING. As of 2026-09-19 production was TWO migrations behind
-- local: 20260525000200_drop_tiktok and 20260525000300_refund_requests had
-- never been applied. So prod's view still had the tiktok_daily_reminder
-- branch and no refund_request_pending. This file assumes both land first,
-- which they will if migrations are applied in order. Do not cherry pick it.
--
-- ---------------------------------------------------------------------------
-- 2. The Sunday content delivery cron is unscheduled
-- ---------------------------------------------------------------------------
-- cron-sunday-lesson-delivery emailed each active family their week's slides
-- and voiceover and incremented cycle_lessons_delivered. Both jobs are gone:
-- there are no materials to ship, and Phase 1 made a COMPLETED CALL the
-- authoritative advance (see advanceCycleOnce in mark-outcome).
--
-- Unscheduled rather than deleted. The Edge Function source stays on disk
-- through Phase 4 so this is one statement to reverse.
--
-- ⚠️ THE REASON THIS IS SAFE IS PHASE 1, NOT THIS MIGRATION. Before the
-- cycle_counted_at guard, removing this cron would have left a family whose
-- call Tim forgot to mark unbilled forever with nothing on any screen. Do not
-- reorder these phases.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rebuilt view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW derived_tasks_view AS

WITH latest_msg AS (
  SELECT DISTINCT ON (player_id)
    id, player_id, sender_role, body, created_at, waiting_on
  FROM messages
  ORDER BY player_id, created_at DESC
),
latest_vod AS (
  SELECT DISTINCT ON (player_id)
    id, player_id, url, created_at
  FROM vod_uploads
  ORDER BY player_id, created_at DESC
),
latest_prep AS (
  SELECT DISTINCT ON (player_id)
    id, player_id, q1_choice, q2_choice, submitted_at
  FROM prep_responses
  ORDER BY player_id, submitted_at DESC
),
unmarked_call AS (
  SELECT
    cs.id                 AS slot_id,
    cs.curriculum_id,
    cs.week_number,
    cs.live_call_at,
    c.player_id
  FROM curriculum_slots cs
  JOIN curricula c ON c.id = cs.curriculum_id
  WHERE cs.live_call_at IS NOT NULL
    AND cs.live_call_at < NOW() - INTERVAL '2 hours'
    AND cs.live_call_completed_at IS NULL
    AND cs.no_show_at IS NULL
    AND COALESCE(cs.live_call_event_id, '') NOT LIKE 'cancelled:%'
    AND NOT EXISTS (
      SELECT 1 FROM coach_cancels cc
      WHERE cc.curriculum_slot_id = cs.id
    )
)

SELECT
  'message_thread'::text                  AS task_type,
  lm.player_id                            AS client_id,
  p.first_name                            AS client_name,
  lm.created_at                           AS age_in_state,
  lm.id                                   AS source_object_id,
  CASE lm.sender_role
    WHEN 'player' THEN 50
    ELSE 60
  END                                     AS priority_score,
  jsonb_build_object(
    'last_message_body', LEFT(lm.body, 200),
    'last_message_sender_role', lm.sender_role
  )                                       AS task_payload
FROM latest_msg lm
JOIN players p ON p.id = lm.player_id
WHERE lm.waiting_on = 'TIM'

UNION ALL

SELECT
  'trial_decision'::text                  AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  COALESCE(s.trial_call_at, s.updated_at) AS age_in_state,
  s.id                                    AS source_object_id,
  80                                      AS priority_score,
  jsonb_build_object(
    'subscription_status', s.status,
    'lifecycle_state', s.lifecycle_state,
    'trial_call_at', s.trial_call_at
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.waiting_on = 'TIM'
  AND s.status = 'trial'
  AND (
    s.lifecycle_state = 'TRIAL_DONE'
    OR (s.trial_call_at IS NOT NULL AND s.trial_call_at < NOW() - INTERVAL '30 minutes')
    OR s.trial_call_at IS NULL
  )

UNION ALL

SELECT
  'cancellation_event'::text              AS task_type,
  p.id                                    AS client_id,
  p.first_name                            AS client_name,
  ce.created_at                           AS age_in_state,
  ce.id                                   AS source_object_id,
  20                                      AS priority_score,
  jsonb_build_object(
    'classification', ce.classification,
    'initiated_via', ce.initiated_via,
    'hours_until_call', ce.hours_until_call
  )                                       AS task_payload
FROM cancellation_events ce
JOIN subscriptions s ON s.id = ce.subscription_id
JOIN players p ON p.id = s.player_id
WHERE ce.waiting_on = 'TIM'

UNION ALL

SELECT
  'new_student_welcome'::text             AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  s.cycle_started_at                      AS age_in_state,
  s.id                                    AS source_object_id,
  70                                      AS priority_score,
  jsonb_build_object(
    'cycle_started_at', s.cycle_started_at,
    'kid_first_name', p.first_name,
    'subscription_id', s.id
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.lifecycle_state = 'ACTIVE'
  AND s.waiting_on = 'TIM'
  AND s.welcomed_at IS NULL

UNION ALL

SELECT
  'new_trial_booked'::text                AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  s.trial_call_at                         AS age_in_state,
  s.id                                    AS source_object_id,
  40                                      AS priority_score,
  jsonb_build_object(
    'trial_call_at', s.trial_call_at,
    'kid_first_name', p.first_name,
    'subscription_id', s.id
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.lifecycle_state = 'TRIAL_SCHEDULED'
  AND s.trial_call_at IS NOT NULL
  AND s.trial_call_at > NOW() - INTERVAL '30 minutes'

UNION ALL

SELECT
  'parent_started_scheduling'::text       AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  COALESCE(s.scheduling_started_at, s.updated_at) AS age_in_state,
  s.id                                    AS source_object_id,
  35                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'subscription_id', s.id,
    'scheduling_started_at', s.scheduling_started_at,
    'lifecycle_state', s.lifecycle_state,
    'slots_booked', (
      SELECT COUNT(*) FROM curriculum_slots cs
      JOIN curricula c ON c.id = cs.curriculum_id
      WHERE c.player_id = s.player_id
        AND c.status = 'pending_approval'
        AND cs.live_call_at IS NOT NULL
    )
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.lifecycle_state IN ('ACCEPTED_PENDING_SCHEDULING', 'SCHEDULING_IN_PROGRESS')
  AND s.scheduling_started_at IS NOT NULL

UNION ALL

SELECT
  'pending_payment'::text                 AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  COALESCE(s.payment_pending_at, s.updated_at) AS age_in_state,
  s.id                                    AS source_object_id,
  45                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'subscription_id', s.id,
    'payment_pending_at', s.payment_pending_at
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.lifecycle_state = 'PENDING_PAYMENT'

UNION ALL

SELECT
  'past_due_opened'::text                 AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  COALESCE(s.past_due_started_at, s.updated_at) AS age_in_state,
  s.id                                    AS source_object_id,
  55                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'subscription_id', s.id,
    'past_due_started_at', s.past_due_started_at
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.lifecycle_state = 'PAST_DUE'

UNION ALL

SELECT
  'vod_dropped'::text                     AS task_type,
  v.player_id                             AS client_id,
  p.first_name                            AS client_name,
  v.created_at                            AS age_in_state,
  v.id                                    AS source_object_id,
  38                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'vod_url', v.url,
    'subscription_id', s.id
  )                                       AS task_payload
FROM latest_vod v
JOIN players p ON p.id = v.player_id
JOIN subscriptions s ON s.player_id = v.player_id
WHERE s.status = 'trial'
  AND v.created_at > NOW() - INTERVAL '14 days'

UNION ALL

SELECT
  'prep_answered'::text                   AS task_type,
  pr.player_id                            AS client_id,
  p.first_name                            AS client_name,
  pr.submitted_at                         AS age_in_state,
  pr.id                                   AS source_object_id,
  38                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'q1_choice', pr.q1_choice,
    'q2_choice', pr.q2_choice,
    'subscription_id', s.id
  )                                       AS task_payload
FROM latest_prep pr
JOIN players p ON p.id = pr.player_id
JOIN subscriptions s ON s.player_id = pr.player_id
WHERE s.status = 'trial'
  AND pr.submitted_at > NOW() - INTERVAL '14 days'

UNION ALL

SELECT
  'subscription_auto_renew_off'::text     AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  COALESCE(s.last_cancel_at, s.updated_at) AS age_in_state,
  s.id                                    AS source_object_id,
  50                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'subscription_id', s.id,
    'cycle_lessons_delivered', s.cycle_lessons_delivered,
    'cycle_skips_used', s.cycle_skips_used
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.lifecycle_state = 'ACTIVE'
  AND s.auto_renew_enabled = FALSE
  AND s.auto_renew_off_acknowledged_at IS NULL

UNION ALL

SELECT
  'call_outcome_pending'::text            AS task_type,
  uc.player_id                            AS client_id,
  p.first_name                            AS client_name,
  uc.live_call_at                         AS age_in_state,
  uc.slot_id                              AS source_object_id,
  78                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'slot_id', uc.slot_id,
    'week_number', uc.week_number,
    'live_call_at', uc.live_call_at
  )                                       AS task_payload
FROM unmarked_call uc
JOIN players p ON p.id = uc.player_id

UNION ALL

SELECT
  'cycle_drag_out'::text                  AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  s.cycle_started_at                      AS age_in_state,
  s.id                                    AS source_object_id,
  60                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'subscription_id', s.id,
    'cycle_started_at', s.cycle_started_at,
    'cycle_lessons_delivered', s.cycle_lessons_delivered,
    'cycle_skips_used', s.cycle_skips_used,
    'coach_cancels_count', (
      SELECT COUNT(*)
      FROM coach_cancels cc
      JOIN curriculum_slots cs ON cs.id = cc.curriculum_slot_id
      JOIN curricula c ON c.id = cs.curriculum_id
      WHERE c.player_id = s.player_id
        AND c.status = 'active'
    )
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.lifecycle_state = 'ACTIVE'
  AND s.cycle_lessons_delivered < 4
  AND s.cycle_started_at IS NOT NULL
  AND s.cycle_started_at < NOW() - INTERVAL '8 weeks'

UNION ALL

-- Refund request pending: parent submitted a refund request, Peter
-- hasn't acted yet. P77 — sits between call_outcome_pending (P78,
-- because a family is in real-time darkness about whether their call
-- happened) and single_session_needs_lesson (P76). Refund requests
-- involve real money on hold; surfacing them just below the immediate
-- post-call ambiguity is right.
SELECT
  'refund_request_pending'::text          AS task_type,
  COALESCE(p.id, rr.family_id)            AS client_id,
  COALESCE(p.first_name, 'Family')        AS client_name,
  rr.created_at                           AS age_in_state,
  rr.id                                   AS source_object_id,
  77                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'refund_request_id', rr.id,
    'subscription_id', rr.subscription_id,
    'family_id', rr.family_id,
    'amount_cents', rr.amount_cents,
    'charge_date', rr.charge_date,
    'reason', rr.reason
  )                                       AS task_payload
FROM refund_requests rr
JOIN subscriptions s ON s.id = rr.subscription_id
LEFT JOIN players p ON p.id = s.player_id
WHERE rr.status = 'pending'
;
-- ---------------------------------------------------------------------------
-- 2. Unschedule the content delivery crons
-- ---------------------------------------------------------------------------
-- Job names read out of cron.job rather than guessed, because they are
-- INCONSISTENT in the source: the Sunday job is `sunday_lesson_delivery`
-- (underscores) and the cleanup is `cron-rough-draft-cleanup` (hyphens).
--
-- ⚠️ AND THE FIRST VERSION OF THIS BLOCK GUESSED BOTH WRONG AND WOULD HAVE
-- PASSED. It wrapped each unschedule in `IF EXISTS (... WHERE jobname = ...)`,
-- so a wrong name simply skipped, silently, and the migration reported
-- success having disabled nothing. A guard that turns a typo into a no op is
-- worse than no guard.
--
-- So this asserts instead: it counts what it removed and RAISES if neither
-- job was found. A partial state (one already gone) is tolerated, because
-- re-running or a hand cleanup is legitimate; finding NOTHING means the names
-- are wrong and the migration has not done its job.
DO $$
DECLARE
  removed INT := 0;
  jname   TEXT;
BEGIN
  FOR jname IN
    SELECT jobname FROM cron.job
    WHERE jobname IN ('sunday_lesson_delivery', 'cron-rough-draft-cleanup')
  LOOP
    PERFORM cron.unschedule(jname);
    removed := removed + 1;
    RAISE NOTICE 'unscheduled %', jname;
  END LOOP;

  IF removed = 0 THEN
    RAISE EXCEPTION
      'Phase 3 unscheduled no content crons. Expected sunday_lesson_delivery and/or cron-rough-draft-cleanup in cron.job. Check the job names before assuming they were already removed.';
  END IF;
END $$;

COMMIT;
