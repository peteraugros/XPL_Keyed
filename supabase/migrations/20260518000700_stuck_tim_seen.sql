-- ============================================================================
-- XPL Keyed — stuck_events.tim_seen_at
-- ============================================================================
-- Closes the Tim ↔ Dad loop: when Dad picks "Send back with note" the
-- guidance currently lives only on stuck_events.resolution_note. This
-- column lets Tim's admin surface the note as a banner once and then
-- mark it seen so it doesn't keep nagging.
--
-- Per Coach Dashboard Spec/dad-admin-spec.md section 3: "No silent
-- reassignments. Tim should always know when a task came back from Dad
-- and why."
-- ============================================================================

ALTER TABLE stuck_events
  ADD COLUMN IF NOT EXISTS tim_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stuck_events_unseen
  ON stuck_events(resolved_at DESC)
  WHERE resolved_at IS NOT NULL
    AND tim_seen_at IS NULL
    AND resolution_note IS NOT NULL;
