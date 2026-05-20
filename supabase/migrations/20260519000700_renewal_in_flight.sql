-- Idempotency column for the auto-renew cron.
--
-- When cron-auto-renew-detection fires a Stripe PaymentIntent for a
-- cycle that just completed, it stamps renewal_pi_id with the PI's id.
-- The cron's eligibility query filters renewal_pi_id IS NULL so a
-- second run before the webhook arrives doesn't fire a duplicate.
--
-- The Stripe webhook clears renewal_pi_id to NULL when the PI settles
-- (succeeded → next cycle provisioned, lifecycle ACTIVE again;
-- payment_failed → lifecycle PAST_DUE). Either way the field is
-- cleared so the NEXT cycle's renewal can fire when it eventually
-- completes.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS renewal_pi_id TEXT;
