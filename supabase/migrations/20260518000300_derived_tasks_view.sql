-- ============================================================================
-- XPL Keyed — derived_tasks_view (Phase 1: messages + trials + curricula)
-- ============================================================================
-- Per `Coach Dashboard Spec/backend-spec.md` section 6.
--
-- The Home queue is a query against this view. One row per actionable
-- task awaiting Tim. Future phases (per spec section 10) add:
--   * checklist items
--   * dunning beyond day 6
--   * quiet clients (no activity 7+ days)
--   * cancellation_events with waiting_on=TIM
--
-- Phase 1 covers:
--   * message_thread tasks (latest message per kid where waiting_on=TIM)
--   * trial_decision tasks (subscription.status='trial' with waiting_on=TIM)
--   * curriculum_approval tasks (curriculum.status='pending_approval' has
--     waiting_on='PARENT' so it does NOT surface here; included as a
--     placeholder slot for future TIM-side curriculum tasks)
--
-- priority_score values match spec section 6 suggestions. Ordering is
-- priority_score DESC, age_in_state DESC. The Home screen picks the
-- single highest-priority row; the rest are accessible via "more waiting"
-- (admin UI work, future commit).
-- ============================================================================


CREATE OR REPLACE VIEW derived_tasks_view AS

-- ---------------------------------------------------------------------------
-- Message threads where the latest message is waiting on TIM.
-- ---------------------------------------------------------------------------
-- One row per kid (DISTINCT ON player_id, ordered by latest first).
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
  -- Parent-sender messages weight higher than kid-sender. Our schema
  -- doesn't distinguish parent vs player sender today (only the kid
  -- writes from /play), but the field is here so future parent-channel
  -- support slots in.
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

-- ---------------------------------------------------------------------------
-- Trial decisions: subscriptions in 'trial' state with waiting_on='TIM'.
-- Surfaces post-call when Tim needs to pick Take on / Decline / Still deciding.
-- ---------------------------------------------------------------------------
SELECT
  'trial_decision'::text                  AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  s.updated_at                            AS age_in_state,
  s.id                                    AS source_object_id,
  80                                      AS priority_score,
  jsonb_build_object(
    'subscription_status', s.status,
    'lifecycle_state', s.lifecycle_state
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
WHERE s.waiting_on = 'TIM'
  AND s.status = 'trial'

UNION ALL

-- ---------------------------------------------------------------------------
-- Cancellation events Tim needs to review (credit vs forfeit decision).
-- waiting_on=TIM means Tim has not yet ruled on credit assignment.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- RLS note
-- ---------------------------------------------------------------------------
-- Views inherit RLS from their underlying tables (messages, subscriptions,
-- cancellation_events all have *_coach_all policies). So a coach-authed
-- query against derived_tasks_view sees every row; a non-coach sees
-- whatever the family-scoped policies on each source allow. The Home
-- queue endpoint runs coach-authed, so the view returns every TIM-waiting
-- task across all families.
