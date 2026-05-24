-- Lesson bundles (Tim-facing course / collection).
--
-- Lets Tim group related lessons under a titled bundle ("Building
-- Fundamentals", "Endgame Mechanics", etc). Internal organization
-- only for v1; not yet rendered on parent/kid surfaces.
--
-- Single bundle per lesson via bundle_id + bundle_position columns.
-- If a lesson needs to live in multiple bundles later, swap to a join
-- table; for now Tim's library is small enough that single-membership
-- is the right constraint.
--
-- Distinct from the existing series_id (Capstone Mode auto-spawn).
-- A lesson can be in both: part of a capstone series AND part of a
-- broader bundle.

BEGIN;

CREATE TABLE IF NOT EXISTS lesson_bundles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      UUID NOT NULL REFERENCES coaches(id),
  title          TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description    TEXT,
  is_published   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_lesson_bundles_updated_at
  BEFORE UPDATE ON lesson_bundles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS bundle_id UUID
  REFERENCES lesson_bundles(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS bundle_position SMALLINT;

CREATE INDEX IF NOT EXISTS idx_lessons_bundle ON lessons(bundle_id, bundle_position)
  WHERE bundle_id IS NOT NULL;

ALTER TABLE lesson_bundles ENABLE ROW LEVEL SECURITY;

-- Coach can read + write any lesson_bundles row. Same pattern as the
-- existing lessons table's coach-all policy. Service role bypasses RLS.
CREATE POLICY lesson_bundles_coach_all ON lesson_bundles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM coaches c
      WHERE c.auth_user_id = auth.uid() AND c.is_active = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM coaches c
      WHERE c.auth_user_id = auth.uid() AND c.is_active = TRUE
    )
  );

COMMIT;
