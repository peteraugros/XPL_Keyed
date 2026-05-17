-- ============================================================================
-- XPL Keyed — Scheduled jobs (pg_cron + pg_net → Edge Functions)
-- ============================================================================
-- Pattern:
--   * `app_config` is a key-value table populated per environment after deploy
--     (Edge Function base URL, service role key, etc.).
--   * `cron_fire(trigger_name)` reads `app_config`, POSTs to the corresponding
--     Edge Function endpoint via pg_net. Each Edge Function does the real work
--     (query candidates, fan out Discord DMs / web push / email).
--   * pg_cron schedules invoke `cron_fire('<trigger>')`. The cadence is set
--     here; the Edge Function decides what's eligible to send.
--   * After deploy, populate `app_config`:
--       INSERT INTO app_config (key, value) VALUES
--         ('edge_base_url',     'https://<project>.functions.supabase.co'),
--         ('edge_service_key',  '<service-role-jwt>');
-- ============================================================================


CREATE EXTENSION IF NOT EXISTS pg_net;     -- HTTP from inside Postgres


-- ---------------------------------------------------------------------------
-- app_config (env-specific runtime settings)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lock it down — only the postgres / service_role can read or write.
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
-- No policies created; default-deny means only the service role bypasses RLS.


-- ---------------------------------------------------------------------------
-- cron_fire(trigger_name): POST to the Edge Function for a given trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cron_fire(trigger_name TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_url       TEXT;
  service_key    TEXT;
  request_id     BIGINT;
BEGIN
  SELECT value INTO base_url    FROM app_config WHERE key = 'edge_base_url';
  SELECT value INTO service_key FROM app_config WHERE key = 'edge_service_key';

  -- If config isn't populated yet, log and bail. Avoids cron spam pre-deploy.
  IF base_url IS NULL OR service_key IS NULL THEN
    RAISE NOTICE 'cron_fire(%): app_config missing edge_base_url or edge_service_key', trigger_name;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := base_url || '/cron-' || trigger_name,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || service_key
               ),
    body    := jsonb_build_object('trigger', trigger_name, 'fired_at', NOW())
  ) INTO request_id;

  RETURN request_id;
END;
$$;


-- ---------------------------------------------------------------------------
-- Scheduled jobs
-- ---------------------------------------------------------------------------
-- Cadence rules of thumb:
--   * Minute-level: pre-call reminder, waitlist offer expiry (time-sensitive)
--   * Daily: dunning checks, pending-cancel reminders, waitlist freshness
--   * Weekly (Sunday 6am PT = 13:00 UTC): lesson delivery
--
-- The Edge Function for each trigger is responsible for filtering candidates
-- (e.g. `WHERE notified_at_20min IS NULL AND live_call_at BETWEEN NOW()+19m AND NOW()+21m`).

SELECT cron.schedule(
  'twenty_min_pre_call_reminder',
  '* * * * *',                       -- every minute
  $$SELECT cron_fire('twenty-min-pre-call-reminder')$$
);

SELECT cron.schedule(
  'day7_dunning_ping',
  '0 14 * * *',                      -- daily at 14:00 UTC (~ 7am PT)
  $$SELECT cron_fire('day7-dunning-ping')$$
);

SELECT cron.schedule(
  'dunning_parent_reminders',
  '0 15 * * *',                      -- daily at 15:00 UTC; Day 3 + Day 6 emails fire from here
  $$SELECT cron_fire('dunning-parent-reminders')$$
);

SELECT cron.schedule(
  'pending_cancel_lifecycle',
  '0 16 * * *',                      -- daily at 16:00 UTC; day 3/6 reminders + day 7 auto-confirm
  $$SELECT cron_fire('pending-cancel-lifecycle')$$
);

SELECT cron.schedule(
  'waitlist_offer_lifecycle',
  '* * * * *',                       -- every minute; 24hr reminder + 48hr expiry
  $$SELECT cron_fire('waitlist-offer-lifecycle')$$
);

SELECT cron.schedule(
  'waitlist_freshness_check',
  '0 17 * * *',                      -- daily at 17:00 UTC; 60-day "still interested?" emails
  $$SELECT cron_fire('waitlist-freshness-check')$$
);

SELECT cron.schedule(
  'sunday_lesson_delivery',
  '0 13 * * 0',                      -- Sundays at 13:00 UTC (~ 6am PT)
  $$SELECT cron_fire('sunday-lesson-delivery')$$
);
