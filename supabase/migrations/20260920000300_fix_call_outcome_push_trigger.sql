-- Fixes the cron trigger name for the call outcome push (2026-09-20).
--
-- `cron_fire(trigger)` POSTs to `edge_base_url || '/cron-' || trigger`. It
-- supplies the `cron-` prefix itself. 20260524000600 passed the trigger as
-- `'cron-call-outcome-push'`, prefix included, so the URL came out as
--
--   .../cron-cron-call-outcome-push
--
-- which no function answers. Every other job passes the bare name
-- (`'auto-renew-detection'`, `'day7-dunning-ping'` and so on); this one is the
-- single exception and it has been firing every 5 minutes into a 404 since
-- 2026-05-24.
--
-- ⚠️ IT WAS INVISIBLE FOR THE SAME REASON THE WHOLE CRON LAYER WAS: pg_cron
-- records `succeeded` when `cron_fire` returns a pg_net request id, which it
-- does whether the eventual POST is a 200 or a 404. Nothing about a wrong
-- trigger name ever reaches `cron.job_run_details`.
--
-- Worth fixing now rather than later, because until 2026-09-20 no Edge
-- Function was deployed at all, so every trigger name was equally wrong and
-- this one was hidden in the crowd. With the functions deployed, this is the
-- only one that still cannot be reached.
--
-- The schedule and the job name are unchanged; only the argument moves.

BEGIN;

DO $$
DECLARE
  found INT := 0;
BEGIN
  SELECT count(*) INTO found FROM cron.job WHERE jobname = 'cron-call-outcome-push';

  IF found = 0 THEN
    RAISE EXCEPTION
      'cron-call-outcome-push is not scheduled. Refusing to guess: check cron.job before assuming it was renamed or removed.';
  END IF;

  PERFORM cron.unschedule('cron-call-outcome-push');
  PERFORM cron.schedule(
    'cron-call-outcome-push',
    '*/5 * * * *',
    $inner$ SELECT cron_fire('call-outcome-push') $inner$
  );
END $$;

-- Read it back, and assert the property rather than the string: no scheduled
-- job may pass a trigger that already carries the prefix cron_fire adds.
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(jobname, ', ') INTO bad
  FROM cron.job
  WHERE command ~ 'cron_fire\(''cron-';

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'these jobs still double prefix their trigger: %', bad;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'cron-call-outcome-push'
      AND command LIKE '%cron_fire(''call-outcome-push'')%'
  ) THEN
    RAISE EXCEPTION 'cron-call-outcome-push was not rescheduled with the bare trigger name';
  END IF;
END $$;

COMMIT;
