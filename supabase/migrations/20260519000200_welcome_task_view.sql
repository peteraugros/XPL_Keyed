-- Adds new_student_welcome to derived_tasks_view.
--
-- A new_student_welcome task surfaces when:
--   * subscription.lifecycle_state = 'ACTIVE'        (post-payment)
--   * subscription.waiting_on = 'TIM'                (set by the Stripe webhook)
--   * subscription.welcomed_at IS NULL               (Tim hasn't acked yet)
--
-- Priority 70 — higher than message threads (50/60) so it stays on top
-- of a fresh conversion until Tim acts, but lower than cancellation_event
-- (20) and trial_decision (80) which are time-sensitive. Conversions can
-- wait a few hours; an in-flight 3rd cancel cannot.
--
-- The task never auto-dismisses (per locked decision 1). The welcome
-- endpoint stamps welcomed_at when Tim taps "I welcomed them," which
-- drops the task from this view immediately.

CREATE OR REPLACE VIEW derived_tasks_view AS

WITH latest_msg AS (
  SELECT DISTINCT ON (player_id)
    id, player_id, sender_role, body, created_at
  FROM messages
  WHERE waiting_on = 'TIM'
  ORDER BY player_id, created_at DESC
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
;
