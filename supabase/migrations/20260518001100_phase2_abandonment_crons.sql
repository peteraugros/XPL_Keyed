-- Phase 2 abandonment crons. Both run hourly.
--
-- cron-scheduling-abandonment: 24h + 72h reminders, 7d release for
-- families in ACCEPTED_PENDING_SCHEDULING or SCHEDULING_IN_PROGRESS.
--
-- cron-payment-abandonment: 6h + 12h reminders, 24h release for
-- families in PENDING_PAYMENT.

SELECT cron.schedule(
  'scheduling_abandonment',
  '0 * * * *',                       -- every hour at :00
  $$SELECT cron_fire('scheduling-abandonment')$$
);

SELECT cron.schedule(
  'payment_abandonment',
  '30 * * * *',                      -- every hour at :30 (offset from above)
  $$SELECT cron_fire('payment-abandonment')$$
);
