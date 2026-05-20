-- Tim's awareness card for "this family's auto renew just turned off".
--
-- Fires when: subscriptions.auto_renew_enabled = FALSE
--   AND lifecycle_state = 'ACTIVE'
--   AND auto_renew_off_acknowledged_at IS NULL
--
-- Card auto-drops when EITHER:
--   * Tim hits "Re-enable auto renew" on the client card (the endpoint
--     also resets cycle_skips_used to 0 + clears acknowledged_at).
--   * Tim dismisses with "Got it" → sets auto_renew_off_acknowledged_at.
--   * Cycle ends naturally (lifecycle_state moves off ACTIVE).
--
-- Priority 50: between past_due_opened (55) and player-channel
-- messages (50). Calm urgency — the family is mid-cycle, no money lost,
-- no immediate decision required.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS auto_renew_off_acknowledged_at TIMESTAMPTZ;

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

-- Auto-renew turned off for an active subscription. Surfaces while
-- the family is still mid-cycle, so Tim can reach out if he wants to
-- save the relationship. Drops once acknowledged or once the cycle ends.
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
;
