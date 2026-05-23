-- Relax the lesson_xor_vod CHECK constraint on curriculum_slots so a
-- slot can legitimately exist with neither lesson_id nor vod_url set.
-- This is the "lesson TBD" state used by single-session purchases: the
-- parent pays $24, the slot is created, then Tim assigns the lesson
-- (or builds a new one) after reading the parent's "what to help with"
-- intake answer.
--
-- Original constraint:
--   * lesson mode:   is_vod_review=FALSE + lesson_id NOT NULL + vod_url NULL
--   * VOD mode:      is_vod_review=TRUE  + lesson_id NULL     + vod_url NOT NULL
--
-- New constraint adds a third valid state:
--   * TBD mode:      is_vod_review=FALSE + lesson_id NULL     + vod_url NULL
--
-- We still forbid the "both set" combination (lesson_id NOT NULL AND
-- vod_url NOT NULL) and the "VOD without URL" combination
-- (is_vod_review=TRUE + vod_url NULL). The TBD state only applies when
-- is_vod_review=FALSE since a VOD review by definition needs a VOD URL.

ALTER TABLE curriculum_slots
  DROP CONSTRAINT IF EXISTS lesson_xor_vod;

ALTER TABLE curriculum_slots
  ADD CONSTRAINT lesson_xor_vod CHECK (
    (is_vod_review = FALSE AND lesson_id IS NOT NULL AND vod_url IS NULL) OR
    (is_vod_review = TRUE  AND lesson_id IS NULL     AND vod_url IS NOT NULL) OR
    (is_vod_review = FALSE AND lesson_id IS NULL     AND vod_url IS NULL)
  );
