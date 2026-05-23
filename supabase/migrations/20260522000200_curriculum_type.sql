-- curriculum_type
-- ---------------
-- Distinguishes subscription-style 4-week curricula from one-off
-- single coaching sessions ($24, no auto-renew, single slot). Adding
-- as an enum so a future third type (e.g., parent-pair group session,
-- intensives, tournament prep packages) doesn't force a boolean
-- rewrite later.
--
-- Default 'subscription' backfills every existing row at write time
-- via Postgres's DEFAULT clause. The flag is consumed by:
--   * cron-auto-renew-detection: skip subscriptions whose active
--     curriculum is single_session (won't fire renewal PIs).
--   * provisionNextCycle in src/lib/lessons/auto-renew.ts: also skips.
--   * derived_tasks_view: future filters can join on this if a task
--     type proves to leak through (cycle_drag_out is the closest).
--
-- For single_session subscriptions, the creating endpoint additionally
-- sets `auto_renew_enabled=FALSE` and stamps
-- `auto_renew_off_acknowledged_at=NOW()` so the
-- `subscription_auto_renew_off` task type never surfaces in /admin.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'curriculum_type_t'
  ) THEN
    CREATE TYPE curriculum_type_t AS ENUM ('subscription', 'single_session');
  END IF;
END $$;

ALTER TABLE curricula
  ADD COLUMN IF NOT EXISTS curriculum_type curriculum_type_t
  NOT NULL DEFAULT 'subscription';
