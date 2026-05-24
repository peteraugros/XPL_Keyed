-- pg_cron schedule for the call-outcome push notification cron.
-- Fires every 5 minutes. Finds live calls that ended 30+ minutes ago
-- with no outcome marked, sends Tim a push, stamps the idempotency column.

SELECT cron.schedule(
  'cron-call-outcome-push',
  '*/5 * * * *',
  $$ SELECT cron_fire('cron-call-outcome-push') $$
);
