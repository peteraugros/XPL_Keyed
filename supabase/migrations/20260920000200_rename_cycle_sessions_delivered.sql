-- Renames subscriptions.cycle_lessons_delivered to cycle_sessions_delivered
-- (2026-09-20).
--
-- The last thing in the schema still named for the content era. It counts
-- COACHING SESSIONS: mark-outcome moves it when a call is completed, the
-- $56 charge fires at 4, and it never had anything to do with lessons after
-- Phase 1 made a completed call the authoritative advance.
--
-- Left alone during Phase 5 on purpose, because a rename touches
-- derived_tasks_view and roughly sixty readers and deserved its own change
-- rather than riding along with a destructive migration.
--
-- ---------------------------------------------------------------------------
-- TWO NAMES, AND ONLY ONE OF THEM RENAMES ITSELF
-- ---------------------------------------------------------------------------
-- Postgres stores a view's column references by attribute number, so
-- `s.cycle_lessons_delivered` inside derived_tasks_view follows the rename on
-- its own. Verified rather than assumed: after the rename the definition reads
-- `s.cycle_sessions_delivered` with no action taken.
--
-- What does NOT follow is the JSON KEY. Two branches build
-- `jsonb_build_object(..., 'cycle_lessons_delivered', s.cycle_...)`, and that
-- key is a string literal. `AdminClient.tsx` reads
-- `payload.cycle_lessons_delivered` off task_payload, so leaving it would give
-- the column one name and its own payload another ; the drift this rename
-- exists to remove, surviving inside the thing being renamed.
--
-- So the view is re-emitted with the literal corrected. The definition below
-- was generated from the live post-rename `pg_get_viewdef` rather than
-- retyped, and the whole migration was rehearsed in a rolled back transaction:
-- 14 branches before and after, no occurrence of the old name anywhere in the
-- result, and the view still queryable.
--
-- ⚠️ NOTHING DEPLOYED READS THIS COLUMN OUTSIDE THE NEXT APP. Measured on
-- 2026-09-20: `supabase functions list` returns ZERO functions on production,
-- so `cron-auto-renew-detection`, which filters on this column, is not running
-- anywhere. Its source is updated with everything else. If Edge Functions are
-- ever deployed, they must be redeployed WITH a rename like this one, because
-- they are not part of the Railway build.

BEGIN;

-- Idempotent: safe to re-run, and says so rather than failing obscurely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'cycle_lessons_delivered'
  ) THEN
    ALTER TABLE public.subscriptions
      RENAME COLUMN cycle_lessons_delivered TO cycle_sessions_delivered;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'cycle_sessions_delivered'
  ) THEN
    RAISE EXCEPTION
      'subscriptions has neither cycle_lessons_delivered nor cycle_sessions_delivered. Refusing to guess which schema this is.';
  END IF;
END $$;

-- Re-emitted only to correct the JSON key. Every branch is otherwise byte
-- identical to what Phase 3 left behind.
CREATE OR REPLACE VIEW public.derived_tasks_view AS
 WITH latest_msg AS (
         SELECT DISTINCT ON (messages.player_id) messages.id,
            messages.player_id,
            messages.sender_role,
            messages.body,
            messages.created_at,
            messages.waiting_on
           FROM messages
          ORDER BY messages.player_id, messages.created_at DESC
        ), latest_vod AS (
         SELECT DISTINCT ON (vod_uploads.player_id) vod_uploads.id,
            vod_uploads.player_id,
            vod_uploads.url,
            vod_uploads.created_at
           FROM vod_uploads
          ORDER BY vod_uploads.player_id, vod_uploads.created_at DESC
        ), latest_prep AS (
         SELECT DISTINCT ON (prep_responses.player_id) prep_responses.id,
            prep_responses.player_id,
            prep_responses.q1_choice,
            prep_responses.q2_choice,
            prep_responses.submitted_at
           FROM prep_responses
          ORDER BY prep_responses.player_id, prep_responses.submitted_at DESC
        ), unmarked_call AS (
         SELECT cs.id AS slot_id,
            cs.curriculum_id,
            cs.week_number,
            cs.live_call_at,
            c.player_id
           FROM curriculum_slots cs
             JOIN curricula c ON c.id = cs.curriculum_id
          WHERE cs.live_call_at IS NOT NULL AND cs.live_call_at < (now() - '02:00:00'::interval) AND cs.live_call_completed_at IS NULL AND cs.no_show_at IS NULL AND COALESCE(cs.live_call_event_id, ''::text) !~~ 'cancelled:%'::text AND NOT (EXISTS ( SELECT 1
                   FROM coach_cancels cc
                  WHERE cc.curriculum_slot_id = cs.id))
        )
 SELECT 'message_thread'::text AS task_type,
    lm.player_id AS client_id,
    p.first_name AS client_name,
    lm.created_at AS age_in_state,
    lm.id AS source_object_id,
        CASE lm.sender_role
            WHEN 'player'::text THEN 50
            ELSE 60
        END AS priority_score,
    jsonb_build_object('last_message_body', "left"(lm.body, 200), 'last_message_sender_role', lm.sender_role) AS task_payload
   FROM latest_msg lm
     JOIN players p ON p.id = lm.player_id
  WHERE lm.waiting_on = 'TIM'::waiting_on_t
UNION ALL
 SELECT 'trial_decision'::text AS task_type,
    s.player_id AS client_id,
    p.first_name AS client_name,
    COALESCE(s.trial_call_at, s.updated_at) AS age_in_state,
    s.id AS source_object_id,
    80 AS priority_score,
    jsonb_build_object('subscription_status', s.status, 'lifecycle_state', s.lifecycle_state, 'trial_call_at', s.trial_call_at) AS task_payload
   FROM subscriptions s
     JOIN players p ON p.id = s.player_id
  WHERE s.waiting_on = 'TIM'::waiting_on_t AND s.status = 'trial'::text AND (s.lifecycle_state = 'TRIAL_DONE'::lifecycle_state_t OR s.trial_call_at IS NOT NULL AND s.trial_call_at < (now() - '00:30:00'::interval) OR s.trial_call_at IS NULL)
UNION ALL
 SELECT 'cancellation_event'::text AS task_type,
    p.id AS client_id,
    p.first_name AS client_name,
    ce.created_at AS age_in_state,
    ce.id AS source_object_id,
    20 AS priority_score,
    jsonb_build_object('classification', ce.classification, 'initiated_via', ce.initiated_via, 'hours_until_call', ce.hours_until_call) AS task_payload
   FROM cancellation_events ce
     JOIN subscriptions s ON s.id = ce.subscription_id
     JOIN players p ON p.id = s.player_id
  WHERE ce.waiting_on = 'TIM'::waiting_on_t
UNION ALL
 SELECT 'new_student_welcome'::text AS task_type,
    s.player_id AS client_id,
    p.first_name AS client_name,
    s.cycle_started_at AS age_in_state,
    s.id AS source_object_id,
    70 AS priority_score,
    jsonb_build_object('cycle_started_at', s.cycle_started_at, 'kid_first_name', p.first_name, 'subscription_id', s.id) AS task_payload
   FROM subscriptions s
     JOIN players p ON p.id = s.player_id
  WHERE s.lifecycle_state = 'ACTIVE'::lifecycle_state_t AND s.waiting_on = 'TIM'::waiting_on_t AND s.welcomed_at IS NULL
UNION ALL
 SELECT 'new_trial_booked'::text AS task_type,
    s.player_id AS client_id,
    p.first_name AS client_name,
    s.trial_call_at AS age_in_state,
    s.id AS source_object_id,
    40 AS priority_score,
    jsonb_build_object('trial_call_at', s.trial_call_at, 'kid_first_name', p.first_name, 'subscription_id', s.id) AS task_payload
   FROM subscriptions s
     JOIN players p ON p.id = s.player_id
  WHERE s.lifecycle_state = 'TRIAL_SCHEDULED'::lifecycle_state_t AND s.trial_call_at IS NOT NULL AND s.trial_call_at > (now() - '00:30:00'::interval)
UNION ALL
 SELECT 'parent_started_scheduling'::text AS task_type,
    s.player_id AS client_id,
    p.first_name AS client_name,
    COALESCE(s.scheduling_started_at, s.updated_at) AS age_in_state,
    s.id AS source_object_id,
    35 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'subscription_id', s.id, 'scheduling_started_at', s.scheduling_started_at, 'lifecycle_state', s.lifecycle_state, 'slots_booked', ( SELECT count(*) AS count
           FROM curriculum_slots cs
             JOIN curricula c ON c.id = cs.curriculum_id
          WHERE c.player_id = s.player_id AND c.status = 'pending_approval'::text AND cs.live_call_at IS NOT NULL)) AS task_payload
   FROM subscriptions s
     JOIN players p ON p.id = s.player_id
  WHERE (s.lifecycle_state = ANY (ARRAY['ACCEPTED_PENDING_SCHEDULING'::lifecycle_state_t, 'SCHEDULING_IN_PROGRESS'::lifecycle_state_t])) AND s.scheduling_started_at IS NOT NULL
UNION ALL
 SELECT 'pending_payment'::text AS task_type,
    s.player_id AS client_id,
    p.first_name AS client_name,
    COALESCE(s.payment_pending_at, s.updated_at) AS age_in_state,
    s.id AS source_object_id,
    45 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'subscription_id', s.id, 'payment_pending_at', s.payment_pending_at) AS task_payload
   FROM subscriptions s
     JOIN players p ON p.id = s.player_id
  WHERE s.lifecycle_state = 'PENDING_PAYMENT'::lifecycle_state_t
UNION ALL
 SELECT 'past_due_opened'::text AS task_type,
    s.player_id AS client_id,
    p.first_name AS client_name,
    COALESCE(s.past_due_started_at, s.updated_at) AS age_in_state,
    s.id AS source_object_id,
    55 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'subscription_id', s.id, 'past_due_started_at', s.past_due_started_at) AS task_payload
   FROM subscriptions s
     JOIN players p ON p.id = s.player_id
  WHERE s.lifecycle_state = 'PAST_DUE'::lifecycle_state_t
UNION ALL
 SELECT 'vod_dropped'::text AS task_type,
    v.player_id AS client_id,
    p.first_name AS client_name,
    v.created_at AS age_in_state,
    v.id AS source_object_id,
    38 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'vod_url', v.url, 'subscription_id', s.id) AS task_payload
   FROM latest_vod v
     JOIN players p ON p.id = v.player_id
     JOIN subscriptions s ON s.player_id = v.player_id
  WHERE s.status = 'trial'::text AND v.created_at > (now() - '14 days'::interval)
UNION ALL
 SELECT 'prep_answered'::text AS task_type,
    pr.player_id AS client_id,
    p.first_name AS client_name,
    pr.submitted_at AS age_in_state,
    pr.id AS source_object_id,
    38 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'q1_choice', pr.q1_choice, 'q2_choice', pr.q2_choice, 'subscription_id', s.id) AS task_payload
   FROM latest_prep pr
     JOIN players p ON p.id = pr.player_id
     JOIN subscriptions s ON s.player_id = pr.player_id
  WHERE s.status = 'trial'::text AND pr.submitted_at > (now() - '14 days'::interval)
UNION ALL
 SELECT 'subscription_auto_renew_off'::text AS task_type,
    s.player_id AS client_id,
    p.first_name AS client_name,
    COALESCE(s.last_cancel_at, s.updated_at) AS age_in_state,
    s.id AS source_object_id,
    50 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'subscription_id', s.id, 'cycle_sessions_delivered', s.cycle_sessions_delivered, 'cycle_skips_used', s.cycle_skips_used) AS task_payload
   FROM subscriptions s
     JOIN players p ON p.id = s.player_id
  WHERE s.lifecycle_state = 'ACTIVE'::lifecycle_state_t AND s.auto_renew_enabled = false AND s.auto_renew_off_acknowledged_at IS NULL
UNION ALL
 SELECT 'call_outcome_pending'::text AS task_type,
    uc.player_id AS client_id,
    p.first_name AS client_name,
    uc.live_call_at AS age_in_state,
    uc.slot_id AS source_object_id,
    78 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'slot_id', uc.slot_id, 'week_number', uc.week_number, 'live_call_at', uc.live_call_at) AS task_payload
   FROM unmarked_call uc
     JOIN players p ON p.id = uc.player_id
UNION ALL
 SELECT 'cycle_drag_out'::text AS task_type,
    s.player_id AS client_id,
    p.first_name AS client_name,
    s.cycle_started_at AS age_in_state,
    s.id AS source_object_id,
    60 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'subscription_id', s.id, 'cycle_started_at', s.cycle_started_at, 'cycle_sessions_delivered', s.cycle_sessions_delivered, 'cycle_skips_used', s.cycle_skips_used, 'coach_cancels_count', ( SELECT count(*) AS count
           FROM coach_cancels cc
             JOIN curriculum_slots cs ON cs.id = cc.curriculum_slot_id
             JOIN curricula c ON c.id = cs.curriculum_id
          WHERE c.player_id = s.player_id AND c.status = 'active'::text)) AS task_payload
   FROM subscriptions s
     JOIN players p ON p.id = s.player_id
  WHERE s.lifecycle_state = 'ACTIVE'::lifecycle_state_t AND s.cycle_sessions_delivered < 4 AND s.cycle_started_at IS NOT NULL AND s.cycle_started_at < (now() - '56 days'::interval)
UNION ALL
 SELECT 'refund_request_pending'::text AS task_type,
    COALESCE(p.id, rr.family_id) AS client_id,
    COALESCE(p.first_name, 'Family'::text) AS client_name,
    rr.created_at AS age_in_state,
    rr.id AS source_object_id,
    77 AS priority_score,
    jsonb_build_object('kid_first_name', p.first_name, 'refund_request_id', rr.id, 'subscription_id', rr.subscription_id, 'family_id', rr.family_id, 'amount_cents', rr.amount_cents, 'charge_date', rr.charge_date, 'reason', rr.reason) AS task_payload
   FROM refund_requests rr
     JOIN subscriptions s ON s.id = rr.subscription_id
     LEFT JOIN players p ON p.id = s.player_id
  WHERE rr.status = 'pending'::text;

-- Read it back out of Postgres, not off this file.
DO $$
DECLARE
  def TEXT;
  branches INT;
BEGIN
  def := pg_get_viewdef('public.derived_tasks_view'::regclass);

  IF def LIKE '%cycle_lessons_delivered%' THEN
    RAISE EXCEPTION 'derived_tasks_view still contains the old name';
  END IF;

  SELECT count(*) INTO branches
  FROM regexp_matches(def, '::text AS task_type', 'g');
  IF branches <> 14 THEN
    RAISE EXCEPTION 'derived_tasks_view has % branches, expected 14', branches;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'cycle_sessions_delivered'
  ) THEN
    RAISE EXCEPTION 'the renamed column is not there';
  END IF;
END $$;

COMMIT;
