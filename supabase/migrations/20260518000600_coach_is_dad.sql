-- ============================================================================
-- XPL Keyed — coaches.is_dad flag
-- ============================================================================
-- Distinguishes Tim (is_dad=false) from Peter (is_dad=true). Same table
-- because the schema treats coaches as the platform-operator surface, and
-- Peter is an operator-of-record alongside Tim. The Dad admin route
-- (/dad) reads stuck_events and operational alerts — gated on this flag.
--
-- Per Coach Dashboard Spec/dad-admin-spec.md. For local testing Peter's
-- coach row should have is_dad=true:
--   UPDATE coaches SET is_dad=TRUE WHERE email='peteraugros@gmail.com';
-- (Migration doesn't backfill anyone because Peter's email override may
-- differ per environment.)
-- ============================================================================

ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS is_dad BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_coaches_is_dad
  ON coaches(is_dad)
  WHERE is_dad = TRUE;
