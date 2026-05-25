-- Refund requests: parent-initiated requests against a specific Stripe
-- charge, reviewed by Peter, hard-capped at 60 days post-charge by the
-- API layer.
--
-- Policy (from CLAUDE.md ToS): full refund eligible within 60 days of
-- charge. Outside the window the API refuses to insert. Peter still has
-- the Stripe dashboard if he wants to make an exception. The 60-day
-- math is enforced in app code (route handlers) rather than as a CHECK
-- on this table because charge_date is supplied by the caller; the
-- defense in depth is that the API validates against Stripe at request
-- time. The table just records the audit trail and the decision.
--
-- Each row points at one Stripe PaymentIntent. To prevent a parent
-- double-submitting against the same charge while one is pending, a
-- partial unique index covers status IN ('pending', 'approved'). A
-- denied request can be re-submitted (rare edge case, but harmless).
--
-- Also rebuilds derived_tasks_view with the refund_request_pending
-- branch at P77 — between call_outcome_pending (P78) and lesson stub
-- (P75). Refund waiting on a decision is real-money urgent.

-- ------------------------------------------------------------------------
-- Table
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refund_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The family + subscription this refund concerns. family_id is the
  -- denormalized convenience for RLS + listing on /portal/billing
  -- without an extra join.
  family_id                 UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  subscription_id           UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,

  -- Who submitted the request. ON DELETE SET NULL so deleting a parent
  -- row doesn't wipe the audit trail.
  requested_by_parent_id    UUID REFERENCES parents(id) ON DELETE SET NULL,

  -- The charge being refunded. PI id is the canonical reference because
  -- we issue refunds via stripe.refunds.create({payment_intent: ...}).
  stripe_payment_intent_id  TEXT NOT NULL,
  amount_cents              INTEGER NOT NULL CHECK (amount_cents > 0),
  -- When Stripe captured the money (PI.created). Stored at request time
  -- so the 60-day math is auditable without re-fetching Stripe.
  charge_date               TIMESTAMPTZ NOT NULL,

  -- Parent's free-text reason.
  reason                    TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),

  -- Decision lifecycle. Starts pending; flips to approved or denied
  -- when Peter acts.
  status                    TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),

  decided_by_coach_id       UUID REFERENCES coaches(id) ON DELETE SET NULL,
  decided_at                TIMESTAMPTZ,
  decision_note             TEXT,

  -- Populated when stripe.refunds.create succeeds during approval.
  stripe_refund_id          TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent two open requests against the same PI. Denied requests don't
-- block re-submission (the parent may have submitted with the wrong
-- reason, etc.) so the partial index excludes them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_one_open_per_pi
  ON refund_requests (stripe_payment_intent_id)
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_refund_requests_family
  ON refund_requests (family_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_refund_requests_pending
  ON refund_requests (created_at DESC)
  WHERE status = 'pending';

-- updated_at trigger
CREATE OR REPLACE FUNCTION refund_requests_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refund_requests_updated_at ON refund_requests;
CREATE TRIGGER trg_refund_requests_updated_at
  BEFORE UPDATE ON refund_requests
  FOR EACH ROW
  EXECUTE FUNCTION refund_requests_set_updated_at();


-- ------------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------------
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_requests_coach_all ON refund_requests;
CREATE POLICY refund_requests_coach_all ON refund_requests
  FOR ALL
  USING (is_coach())
  WITH CHECK (is_coach());

DROP POLICY IF EXISTS refund_requests_parent_select ON refund_requests;
CREATE POLICY refund_requests_parent_select ON refund_requests
  FOR SELECT
  USING (family_id = family_id_for_user());

-- Parent INSERT path. Most validation (60-day window, PI ownership,
-- existing open request, PI actually exists in Stripe) happens in the
-- API route, not here — the route has access to Stripe and the date
-- math is cleaner in app code. RLS just gates that the family_id and
-- parent_id match the authed user.
DROP POLICY IF EXISTS refund_requests_parent_insert ON refund_requests;
CREATE POLICY refund_requests_parent_insert ON refund_requests
  FOR INSERT
  WITH CHECK (
    family_id = family_id_for_user()
    AND requested_by_parent_id IN (
      SELECT id FROM parents WHERE auth_user_id = auth.uid()
    )
    AND status = 'pending'
  );


-- ------------------------------------------------------------------------
-- Rebuild derived_tasks_view with the refund_request_pending branch.
-- Identical to the prior definition (20260525000200_drop_tiktok.sql)
-- with one new UNION ALL appended.
-- ------------------------------------------------------------------------
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

SELECT
  'library_running_low'::text             AS task_type,
  c.id                                    AS client_id,
  'Lesson library'                        AS client_name,
  c.created_at                            AS age_in_state,
  c.id                                    AS source_object_id,
  22                                      AS priority_score,
  jsonb_build_object(
    'coach_id', c.id,
    'published_count', (SELECT COUNT(*) FROM lessons WHERE is_published = TRUE)
  )                                       AS task_payload
FROM coaches c
WHERE c.is_active = TRUE
  AND (SELECT COUNT(*) FROM lessons WHERE is_published = TRUE) < 12

UNION ALL

SELECT
  'single_session_needs_lesson'::text     AS task_type,
  s.player_id                             AS client_id,
  p.first_name                            AS client_name,
  COALESCE(s.scheduling_started_at, c.created_at) AS age_in_state,
  cs.id                                   AS source_object_id,
  76                                      AS priority_score,
  jsonb_build_object(
    'kid_first_name', p.first_name,
    'subscription_id', s.id,
    'curriculum_id', c.id,
    'slot_id', cs.id,
    'live_call_at', cs.live_call_at,
    'intake_note', c.personalization_note
  )                                       AS task_payload
FROM subscriptions s
JOIN players p ON p.id = s.player_id
JOIN curricula c
  ON c.player_id = s.player_id
  AND c.curriculum_type = 'single_session'
  AND c.status = 'active'
JOIN curriculum_slots cs
  ON cs.curriculum_id = c.id
  AND cs.lesson_id IS NULL
WHERE s.tier = 'single_lesson'
  AND s.status = 'active'
  AND s.lifecycle_state IN ('SCHEDULING_IN_PROGRESS', 'ACTIVE')

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
