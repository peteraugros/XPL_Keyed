-- Reschedule + skip system, per /Users/peteraugros/Desktop/xpl-reschedule-spec.md.
--
-- Three new columns on subscriptions:
--
--   cycle_skips_used      INT NOT NULL DEFAULT 0   (0..3)
--     The per-cycle counter that increments on:
--       * a >24hr reschedule that picks a time MORE than 7 days after
--         the original slot (pushes cadence outward)
--       * a <24hr cancel of the live call
--     Free moves (within 7 days of original) do NOT increment.
--     Resets to 0 when the cycle's 4th lesson delivers.
--
--   auto_renew_enabled    BOOLEAN NOT NULL DEFAULT TRUE
--     Falls to FALSE when cycle_skips_used hits 3. Family completes
--     the current cycle to lesson 4 but no next-cycle charge fires.
--     Restored to TRUE automatically when a future cycle completes
--     with 0 skips (grace recovery), or via the coach override button.
--
--   cycle_timezone        TEXT NOT NULL DEFAULT 'America/Los_Angeles'
--     Frozen at cycle creation. ALL cadence math (24hr boundary,
--     7-day window, uniform-pattern detection) runs in this timezone.
--     DST shifts and parent-travel timezone changes do not affect rule
--     evaluation; UI rendering still uses the browser's local timezone.
--
-- The existing cycle_cancels_used column stays for backward compat
-- during the rollout. Both columns are kept in sync until a follow-up
-- migration drops cycle_cancels_used.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS cycle_skips_used SMALLINT NOT NULL DEFAULT 0
    CHECK (cycle_skips_used >= 0 AND cycle_skips_used <= 3),
  ADD COLUMN IF NOT EXISTS auto_renew_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cycle_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles';

-- Backfill: existing rows keep their counter under the new name.
UPDATE subscriptions
SET cycle_skips_used = cycle_cancels_used
WHERE cycle_cancels_used > 0 AND cycle_skips_used = 0;

-- Index supporting the grace-recovery cron's "find subscriptions where
-- auto_renew_enabled=FALSE on a still-active row" lookup.
CREATE INDEX IF NOT EXISTS idx_subscriptions_auto_renew_off
  ON subscriptions (id)
  WHERE auto_renew_enabled = FALSE AND status = 'active';
