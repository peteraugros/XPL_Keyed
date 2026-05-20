-- Post-call outcome marking (Round 2 of /admin/calendar).
--
-- Tim marks every live call with one of three outcomes:
--   1. ✅ Done           → sets live_call_completed_at + optional coach_note
--   2. 🟡 Student no-show → sets no_show_at (charge skip OR courtesy pass)
--   3. 🟠 I had to cancel last minute → writes coach_cancels row (same as
--      proactive coach cancel, just after the fact)
--
-- This migration:
--   a. Adds `coach_note` column to curriculum_slots (Tim's 2-3 sentence
--      observation for the parent, surfaces on /portal/progress).
--   b. Extends derived_tasks_view with `call_outcome_pending` (P78):
--      fires 2 hours after live_call_at when the slot has no outcome
--      stamped (no completed, no no-show, no coach_cancel for the slot,
--      not parent-cancel-sentinel'd). Stays until Tim marks an outcome —
--      this is the "Tim forgot" backstop.

-- ------------------------------------------------------------------------
-- coach_note column
-- ------------------------------------------------------------------------
ALTER TABLE curriculum_slots
  ADD COLUMN IF NOT EXISTS coach_note TEXT,
  ADD COLUMN IF NOT EXISTS coach_note_at TIMESTAMPTZ;


-- ------------------------------------------------------------------------
-- Extend derived_tasks_view with call_outcome_pending (P78)
-- ------------------------------------------------------------------------
CREATE OR REPLACE VIEW derived_tasks_view AS

WITH latest_msg AS (
  SELECT DISTINCT ON (player_id)
    id, player_id, sender_role, body, created_at
  FROM messages
  WHERE waiting_on = 'TIM'
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
next_stub_slot AS (
  SELECT DISTINCT ON (s.id)
    s.id          AS subscription_id,
    s.player_id   AS player_id,
    cs.id         AS slot_id,
    cs.week_number,
    cs.live_call_at,
    l.id          AS lesson_id,
    jsonb_array_length(COALESCE(l.slides, '[]'::jsonb)) AS slide_count
  FROM subscriptions s
  JOIN curricula c ON c.player_id = s.player_id AND c.status = 'active'
  JOIN curriculum_slots cs ON cs.curriculum_id = c.id AND cs.delivered_at IS NULL
  LEFT JOIN lessons l ON l.id = cs.lesson_id
  WHERE s.status = 'active'
    AND s.lifecycle_state = 'ACTIVE'
  ORDER BY s.id, cs.week_number ASC
),
-- Live calls whose start time was 2+ hours ago AND have NO outcome
-- recorded yet. Excludes parent-cancel sentinels (already settled) and
-- any slot that already has a coach_cancels row.
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
  'lesson_authoring_needed'::text         AS task_type,
  ns.player_id                            AS client_id,
  p.first_name                            AS client_name,
  COALESCE(ns.live_call_at, NOW())        AS age_in_state,
  ns.slot_id                              AS source_object_id,
  75                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'subscription_id', ns.subscription_id,
    'lesson_id', ns.lesson_id,
    'slot_id', ns.slot_id,
    'week_number', ns.week_number,
    'live_call_at', ns.live_call_at
  )                                       AS task_payload
FROM next_stub_slot ns
JOIN players p ON p.id = ns.player_id
WHERE ns.lesson_id IS NOT NULL
  AND ns.slide_count = 0
  AND (
    ns.live_call_at IS NULL
    OR ns.live_call_at < NOW() + INTERVAL '7 days'
  )

UNION ALL

SELECT
  'tiktok_daily_reminder'::text           AS task_type,
  c.id                                    AS client_id,
  'TikTok funnel'                         AS client_name,
  date_trunc('day', NOW())                AS age_in_state,
  c.id                                    AS source_object_id,
  25                                      AS priority_score,
  jsonb_build_object(
    'coach_id', c.id
  )                                       AS task_payload
FROM coaches c
WHERE c.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM tiktok_comments tc
    WHERE tc.coach_id = c.id
      AND tc.logged_date = (NOW() AT TIME ZONE 'UTC')::date
  )

UNION ALL

-- The "Tim forgot" backstop. Live call ended 2+ hours ago, no outcome
-- recorded. P78 sits just above new_student_welcome (P70) because the
-- gap means a real family is wondering what happened. Stays in the
-- queue until Tim marks Done / no-show / late-cancel.
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
;
