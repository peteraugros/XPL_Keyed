-- Policy update (Peter, 2026-05-19): cap is 2 skips per cycle, not 3.
-- Two strikes turn off auto renew; the current cycle still completes
-- through lesson 4, then ends.
--
-- The CHECK constraint added in migration 500 used (0..3). Replace with
-- (0..2). Existing rows (fresh local data only at this point) all have
-- cycle_skips_used <= 2 already, so no clamp needed; the safe pattern
-- still clamps as belt-and-suspenders.

UPDATE subscriptions
SET cycle_skips_used = LEAST(cycle_skips_used, 2)
WHERE cycle_skips_used > 2;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_cycle_skips_used_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_cycle_skips_used_check
    CHECK (cycle_skips_used >= 0 AND cycle_skips_used <= 2);
