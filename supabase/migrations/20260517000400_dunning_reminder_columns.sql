-- ============================================================================
-- XPL Keyed — Dunning parent reminder idempotency columns
-- ============================================================================
-- Day 3 + Day 6 parent reminders during dunning need dedicated idempotency
-- markers, matching the existing pattern for notified_at_day7_dunning,
-- notified_at_third_cancel, and the pending_cancel_reminder_* columns.
-- Used by cron-dunning-parent-reminders.
-- ============================================================================

ALTER TABLE subscriptions
  ADD COLUMN notified_at_dunning_day3 TIMESTAMPTZ,
  ADD COLUMN notified_at_dunning_day6 TIMESTAMPTZ;
