-- ============================================================================
-- XPL Keyed — tim_dad_messages
-- ============================================================================
-- The Tim ↔ Dad channel per Coach Dashboard Spec/dad-admin-spec.md:
-- a small persistent 1:1 thread between Tim and Dad. Separate from the
-- per-family `messages` table (which is kid <-> coach <-> parent-observer)
-- because this thread is operator <-> operator, not coaching content.
--
-- Used for:
--   * Dad's guidance notes back to Tim (alongside the Stuck-return banner
--     which surfaces resolution_note only).
--   * Tim asking Dad questions in the moment.
--   * Quick coordination ("I'll handle Mason's mom, you take Lucas").
--
-- Scope: single-family today (Tim + Peter). When operator-#2 ships, this
-- table grows a `coach_id` to scope to per-pair.
-- ============================================================================


CREATE TABLE IF NOT EXISTS tim_dad_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('tim', 'dad')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tim_dad_messages_created
  ON tim_dad_messages(created_at DESC);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE tim_dad_messages ENABLE ROW LEVEL SECURITY;

-- Both Tim (coach is_active) AND Dad (coach is_dad) read all rows.
-- is_coach() already covers both (it filters on is_active in the helper,
-- and both Tim and Peter's rows are is_active). For inserts, the server
-- routes set sender_role based on coaches.is_dad lookup so the value is
-- trustworthy regardless of body content.
CREATE POLICY tim_dad_messages_coach_all ON tim_dad_messages
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());
