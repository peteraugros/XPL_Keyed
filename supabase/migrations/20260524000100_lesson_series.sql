-- Lesson series binding (Capstone Mode follow-on).
--
-- When the planner detects a multi-part series at Step 3 (Tim answers
-- "yes, they build on each other"), Step 4 lets him put them in
-- teaching order. We then need a way to spawn each foundation lesson
-- as a stub and bind them all together so the library shows them as
-- a coherent series with the capstone as the final lesson.
--
-- series_id = the UUID of the capstone lesson. ALL members of the
-- series (foundations + capstone) carry the same value. The capstone
-- has series_id equal to its own id. Foundations point at the
-- capstone. Querying "all lessons in series X" is just WHERE series_id=X.
--
-- series_position = 1..N for the ordered foundation lessons, N+1 for
-- the capstone. NULL for lessons that aren't in any series (the
-- common case).

BEGIN;

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS series_id UUID
  REFERENCES lessons(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS series_position SMALLINT;

-- Filtered index for fast "all lessons in this series" lookups; series
-- membership is the minority case so the filter keeps the index tiny.
CREATE INDEX IF NOT EXISTS idx_lessons_series ON lessons(series_id, series_position)
  WHERE series_id IS NOT NULL;

COMMIT;
