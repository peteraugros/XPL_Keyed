-- Relax cycle_skips_used CHECK to allow the trigger value.
--
-- Framing (Peter, 2026-05-19): the allowance is 2 skips per cycle.
-- The 3rd skip is the trigger that turns off auto renew. The counter
-- needs to be able to store the 3rd skip when it happens (and in
-- theory beyond, since auto-renew-off doesn't stop the parent from
-- forfeiting the last few live calls). Treat the CHECK as a sanity
-- bound, not a business rule.

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_cycle_skips_used_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_cycle_skips_used_check
    CHECK (cycle_skips_used >= 0 AND cycle_skips_used <= 10);
