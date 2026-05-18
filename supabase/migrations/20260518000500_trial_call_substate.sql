-- ============================================================================
-- XPL Keyed — trial call substate columns + smarter derived_tasks_view
-- ============================================================================
-- Closes the backfill gap noted in CLAUDE.md: trial subscriptions were
-- backfilled to waiting_on='TIM', which over-classifies pre-call trials
-- (the call hasn't happened yet; Tim has nothing to decide).
--
-- Adds `trial_call_event_uri` + `trial_call_at` columns to subscriptions.
-- Calendly's `invitee.created` webhook stores them. The view then filters
-- trial_decision tasks to only surface trials where the call has actually
-- ended (or where lifecycle_state is explicitly TRIAL_DONE).
--
-- This avoids needing a cron to flip TRIAL_SCHEDULED -> TRIAL_DONE — the
-- view does the time-based transition lazily on read. A future cron can
-- still update the column for correctness; the view stays the source of
-- truth for Home queue semantics.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_call_event_uri TEXT,
  ADD COLUMN IF NOT EXISTS trial_call_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_call_at
  ON subscriptions(trial_call_at)
  WHERE trial_call_at IS NOT NULL;


-- ---------------------------------------------------------------------------
-- derived_tasks_view: smarter trial_decision filter
-- ---------------------------------------------------------------------------
-- A trial_decision task only surfaces when:
--   * lifecycle_state = 'TRIAL_DONE' (explicitly transitioned by code), OR
--   * trial_call_at is set AND already in the past (with a 30 min buffer
--     to let the call run long without flickering the task in mid-call), OR
--   * status='trial' AND trial_call_at IS NULL (pre-Calendly-wiring trials;
--     fall back to the prior behavior so existing data still surfaces).
--
-- This means new trials with a real trial_call_at will NOT appear as
-- TIM-tasks until the scheduled call time has passed.
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
  -- age_in_state anchors on the trial_call_at when known; falls back to
  -- subscription.updated_at otherwise.
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
;
