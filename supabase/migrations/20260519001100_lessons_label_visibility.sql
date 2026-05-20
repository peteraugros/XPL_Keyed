-- The lessons_assigned_select RLS policy gated on (is_published = true).
-- That blocked the parent + player /portal/sessions + /play views from
-- reading the lesson title (fortnite_label) before Tim published the
-- content. Result: every session row rendered as the generic "Lesson"
-- fallback even when Tim had typed a real title in the curriculum
-- drafter.
--
-- The title (and the parent translation pair) is meant to be visible
-- the moment Tim assigns the lesson to a curriculum_slot — that's the
-- whole point of the drafter form. Content (slides, audio) is a
-- separate concern; if we ever need to gate THAT on is_published,
-- it'll happen at the asset-fetch layer (signed URL minting), not at
-- the row-read layer.

DROP POLICY IF EXISTS lessons_assigned_select ON lessons;

CREATE POLICY lessons_assigned_select ON lessons
  FOR SELECT
  USING (
    id IN (
      SELECT cs.lesson_id
      FROM curriculum_slots cs
      JOIN curricula c ON c.id = cs.curriculum_id
      JOIN players p ON p.id = c.player_id
      WHERE p.family_id = family_id_for_user()
        AND cs.lesson_id IS NOT NULL
    )
  );
