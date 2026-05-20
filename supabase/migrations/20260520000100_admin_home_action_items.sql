-- Two new Focused Home task types + the table that backs one of them.
--
-- 1. lesson_authoring_needed (P75)
--    Fires for any active client where the next-up curriculum slot has
--    a stub lesson (empty slides) within 7 days. Stub lessons are
--    created by Stage C take-on (or by auto-renew provisioning) with
--    empty `slides` JSONB; Tim has to fill in real content before the
--    Sunday cron tries to deliver it. This is the highest-risk gap
--    today because a delivered empty lesson = parent gets a broken
--    email.
--
-- 2. tiktok_daily_reminder (P25)
--    Daily awareness card nudging Tim to drop his Fortnite-creator
--    comment for the day. The TikTok organic-comment funnel is the
--    platform's primary acquisition channel (per CLAUDE.md). One row
--    per day in tiktok_comments tracks completion.
--
-- The view is rebuilt CREATE OR REPLACE with both new branches added
-- at the bottom; everything else preserved.

-- ------------------------------------------------------------------------
-- New table: tiktok_comments
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tiktok_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id     UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per coach per UTC date — keeps the "did Tim log today?" query
-- cheap. We dedupe on a generated date column for the partial index.
ALTER TABLE tiktok_comments
  ADD COLUMN IF NOT EXISTS logged_date DATE
    GENERATED ALWAYS AS ((logged_at AT TIME ZONE 'UTC')::date) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tiktok_comments_one_per_day
  ON tiktok_comments (coach_id, logged_date);

ALTER TABLE tiktok_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiktok_comments_coach_all ON tiktok_comments;
CREATE POLICY tiktok_comments_coach_all ON tiktok_comments
  FOR ALL
  USING (is_coach())
  WITH CHECK (is_coach());


-- ------------------------------------------------------------------------
-- Rebuild derived_tasks_view with the 2 new branches
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
-- Stub-lesson surfacing: for each active subscription, find the next
-- non-delivered curriculum_slot in the active curriculum, and check
-- whether its lesson has empty slides (= stub).
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

-- Stub-lesson surfacing. P75 — just below new_student_welcome (P70)
-- because letting a stub lesson reach the Sunday cron is a delivery
-- bug. Fires when the next pending slot (lowest week_number with
-- delivered_at IS NULL) has lesson.slides = empty AND the live call is
-- within 7 days (so we surface it as it gets close, not the whole cycle).
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

-- TikTok daily comment reminder. Lives outside the client model: one
-- row per active coach, fires once per UTC day. Drops as soon as Tim
-- inserts a tiktok_comments row for today.
--
-- coalesce + lateral subquery would also work; we use NOT EXISTS so the
-- query plan is straightforward.
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
;
