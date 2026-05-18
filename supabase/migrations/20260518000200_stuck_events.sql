-- ============================================================================
-- XPL Keyed — stuck_events table
-- ============================================================================
-- Per `Coach Dashboard Spec/backend-spec.md` section 7.
--
-- Every Stuck-button tap creates a row here. Source of truth for:
--   * The Tim ↔ Dad relationship's actual activity
--   * Patterns over time (Tim Stucks on payment decisions repeatedly →
--     pattern worth noticing)
--   * Future weekly review for Dad showing where Tim needed help
--
-- Stuck history is never shown to Tim as a count or score (per the
-- shame-free design principle). It's operational data for Dad's view +
-- longitudinal awareness.
-- ============================================================================


CREATE TABLE IF NOT EXISTS stuck_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- tim_user_id == the coach who hit Stuck. Reusing coaches table since
  -- Tim is the only Stuck-eligible coach for MVP; multi-coach support
  -- comes later.
  tim_user_id     UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,

  -- object_type + object_id together address the thing Tim got stuck on.
  -- object_type values match the source tables we Stuck-from. Loose enum
  -- to allow new sources later without a migration.
  object_type     TEXT NOT NULL CHECK (object_type IN (
                    'message_thread',
                    'trial_decision',
                    'checklist_item',
                    'curriculum_approval',
                    'cancellation_event',
                    'dunning',
                    'other'
                  )),
  object_id       UUID NOT NULL,

  -- Optional note Tim can add when hitting Stuck. Blank is fine.
  reason          TEXT,

  -- Resolution columns. NULL until Dad resolves.
  resolved_by     UUID REFERENCES parents(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolution_type TEXT CHECK (resolution_type IN (
                    'handled_directly',
                    'returned_to_tim',
                    'no_action_needed'
                  )),
  -- Dad's note back to Tim, if any. Shows up in the Tim ↔ Dad channel
  -- and as a banner on Tim's next task view.
  resolution_note TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stuck_events_open
  ON stuck_events(created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stuck_events_by_object
  ON stuck_events(object_type, object_id);

CREATE INDEX IF NOT EXISTS idx_stuck_events_tim
  ON stuck_events(tim_user_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Coach has full access (Tim creates rows when he hits Stuck).
-- Dad is technically a `parents` row in the schema today (he's the
-- account-of-record for his own family setup if he had one) — but
-- conceptually he's the platform operator. For MVP, only the coach
-- writes here. Dad's admin reads via service-role (the Dad admin will
-- live behind a separate auth route once built). No parent/player RLS.
ALTER TABLE stuck_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY stuck_events_coach_all ON stuck_events
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());
