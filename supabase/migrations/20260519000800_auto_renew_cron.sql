-- Schedule the auto-renew detection cron. Daily at 13:30 UTC — 30
-- minutes after the Sunday lesson delivery cron (13:00 UTC) so any
-- cycle-completing Sunday delivery has already incremented
-- cycle_lessons_delivered to 4 before we check.

SELECT cron.schedule(
  'auto_renew_detection',
  '30 13 * * *',                     -- daily at 13:30 UTC
  $$SELECT cron_fire('auto-renew-detection')$$
);
