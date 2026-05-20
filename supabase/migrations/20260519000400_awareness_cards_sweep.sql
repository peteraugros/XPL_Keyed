-- Adds 5 new awareness card types to derived_tasks_view:
--   * parent_started_scheduling  (lifecycle ∈ accepted/scheduling, awareness)
--   * pending_payment            (lifecycle = PENDING_PAYMENT, awareness)
--   * past_due_opened            (lifecycle = PAST_DUE, soft urgency, amber)
--   * vod_dropped                (kid posted VOD during trial)
--   * prep_answered              (kid completed prep questions during trial)
--
-- All are awareness cards (waiting_on filter relaxed). They auto-drop
-- when the underlying state changes — parent books last slot, parent
-- pays, Stripe recovers, trial call wraps, etc. No "mark as seen"
-- action needed.
--
-- Priority tiers:
--   80 trial_decision (action required, call ended)
--   70 new_student_welcome (action required, fresh sale)
--   60 message_thread coach-side
--   55 past_due_opened (soft urgency, money topic)
--   50 message_thread player-side
--   45 pending_payment (about to convert, awareness)
--   40 new_trial_booked (awareness)
--   38 vod_dropped / prep_answered (kid showed up)
--   35 parent_started_scheduling (awareness)
--   20 cancellation_event

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

-- Parent landed on scheduling but hasn't finished. ACCEPTED_PENDING_SCHEDULING
-- or SCHEDULING_IN_PROGRESS, anchored on scheduling_started_at so Tim
-- knows how long they've been at it.
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

-- All 4 slots reserved, waiting for parent to complete Stripe checkout.
-- Soft urgency — they're a click away from converting.
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

-- Subscription dropped into PAST_DUE. Stripe is auto-retrying; Tim
-- doesn't have to act unless it sticks past Day 7 (which fires its own
-- separate notification path). Awareness for now.
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

-- Kid dropped a VOD during trial. Awareness so Tim can pre-watch.
-- Only surfaces while the trial is active; once trial_decision fires
-- (after the call), this card is naturally outranked.
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

-- Kid answered the 3 prep questions during trial. Awareness so Tim
-- can read the answers before the call.
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
;
