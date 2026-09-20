-- Phase 5 of the content-to-coaching simplification (2026-09-20).
--
-- THE DESTRUCTIVE ONE. Phases 1 and 2 were additive, Phase 3 was behavioural
-- and fully reversible, Phase 4 removed the surfaces. This drops the schema
-- the content era stood on. After this the lesson library cannot be brought
-- back by reverting code; it needs a restore.
--
-- What goes:
--
--   lessons                            table (slides, beat sheets, planner
--                                      state, video urls, bundling)
--   lesson_bundles                     table
--   curriculum_slots.lesson_id         the attachment point
--   curriculum_slots.is_vod_review     Tim authored VOD reviews
--   curriculum_slots.vod_url
--   curriculum_slots.vod_talking_points
--   lesson_xor_vod                     CHECK, goes with its columns
--
-- What deliberately STAYS, each for a reason that is easy to get wrong:
--
--   curriculum_slots.delivered_at   It does not mean "materials delivered".
--                                   It means "this session is settled", and
--                                   coach cancel, no show, scheduling and the
--                                   cancel paths all read it. Dropping it
--                                   would break live behaviour.
--
--   vod_uploads (whole table)       DIFFERENT THING, SAME WORD. This is the
--                                   KID's own gameplay clip, pasted at intake
--                                   (source='paste_url', is_initial_trial_vod)
--                                   and read by /play, /portal/progress, the
--                                   clients page and take-on. It is how Tim
--                                   prepares for a call. Only the COACH
--                                   authored review deliverable is going.
--
--   subscriptions.cycle_lessons_delivered
--                                   Naming leftover from the content era; it
--                                   counts SESSIONS and is what advances the
--                                   billing cycle (Phase 1's advanceCycleOnce).
--                                   Renaming it is a separate change touching
--                                   derived_tasks_view and several readers.
--
--   storage bucket 'lesson-assets'  Out of the stated scope of this phase, and
--                                   PROD HOLDS 6 OBJECTS (measured 2026-09-20)
--                                   which are Tim's real slide, audio and video
--                                   files. No live code references the bucket
--                                   any more, so it costs nothing to leave. It
--                                   comes out as its own decision, after
--                                   somebody looks at what is in it.
--
-- ---------------------------------------------------------------------------
-- ORDER IS LOAD BEARING, AND BOTH OBVIOUS ORDERS FAIL
-- ---------------------------------------------------------------------------
-- The columns and the tables are mutually entangled:
--
--   drop the column first  ->  refused, because the RLS policy
--                              lessons_assigned_select ON lessons reads
--                              curriculum_slots.lesson_id in its USING clause
--   drop the table first   ->  refused, because curriculum_slots_lesson_id_fkey
--                              references it
--
-- So the foreign key comes off first, then the tables (each taking its own
-- policies, indexes and triggers with it), then the columns. Proven in a
-- rolled back transaction before this file was written.
--
-- ---------------------------------------------------------------------------
-- NOTHING HERE USES CASCADE, ON PURPOSE
-- ---------------------------------------------------------------------------
-- As of 2026-09-20 production is FOUR migrations behind local and has none of
-- the simplification applied. Prod's derived_tasks_view therefore still joins
-- `lessons` through next_stub_slot. A CASCADE on the table drop would silently
-- take that view with it, and that view IS Tim's Focused Home queue. Plain
-- RESTRICT refuses instead, which is the right failure direction, and the
-- guard below turns that refusal into a sentence that says what to do.
--
-- Do not add CASCADE to make an error go away here. The error is the feature.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guards. Refuse rather than half apply.
-- ---------------------------------------------------------------------------

-- 0a. Phase 3 must have landed. Asked of pg_depend rather than of the view
-- text, so it stays true if the view is ever rebuilt under another name for
-- the same CTE.
DO $$
DECLARE
  dependents TEXT;
BEGIN
  SELECT string_agg(DISTINCT r.ev_class::regclass::text, ', ')
    INTO dependents
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid
  WHERE d.refobjid = 'public.lessons'::regclass
    AND d.classid  = 'pg_rewrite'::regclass
    AND r.ev_class <> 'public.lessons'::regclass;

  IF dependents IS NOT NULL THEN
    RAISE EXCEPTION
      'Phase 5 refused: % still depend(s) on the lessons table. Phase 3 (20260919000100) removes the only such join. Apply the phases in order rather than cherry picking this one.',
      dependents;
  END IF;
END $$;

-- 0b. No live slot may still be carrying content. If one is, somebody is
-- mid cycle with a lesson attached and this migration would delete what they
-- were promised. Local and prod both measured 0 on 2026-09-20.
DO $$
DECLARE
  attached INT;
BEGIN
  SELECT count(*) INTO attached
  FROM public.curriculum_slots
  WHERE lesson_id IS NOT NULL OR vod_url IS NOT NULL;

  IF attached > 0 THEN
    RAISE EXCEPTION
      'Phase 5 refused: % curriculum_slots still reference a lesson or a coach authored VOD. Settle or clear those sessions first; dropping now would erase content a family was promised.',
      attached;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Back up anything real before it goes
-- ---------------------------------------------------------------------------
-- Local has 0 lessons. PROD HAS 3 (measured 2026-09-20), authored by Tim
-- before the simplification. A plain `supabase db push` that catches prod up
-- would otherwise destroy them with nothing on any screen saying so.
--
-- The backup is created only where there is something to back up, so local
-- stays clean. It is created with RLS ON and NO POLICIES, which under Supabase
-- means service role only: a bare table in `public` is otherwise reachable
-- through PostgREST, and this one holds every lesson Tim ever wrote.
DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n FROM public.lessons;
  IF n > 0 THEN
    EXECUTE 'CREATE TABLE public._backup_lessons_20260920 AS SELECT * FROM public.lessons';
    EXECUTE 'ALTER TABLE public._backup_lessons_20260920 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public._backup_lessons_20260920 FROM anon, authenticated';
    RAISE NOTICE 'Phase 5: backed up % lessons to _backup_lessons_20260920', n;
  END IF;

  SELECT count(*) INTO n FROM public.lesson_bundles;
  IF n > 0 THEN
    EXECUTE 'CREATE TABLE public._backup_lesson_bundles_20260920 AS SELECT * FROM public.lesson_bundles';
    EXECUTE 'ALTER TABLE public._backup_lesson_bundles_20260920 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public._backup_lesson_bundles_20260920 FROM anon, authenticated';
    RAISE NOTICE 'Phase 5: backed up % lesson_bundles to _backup_lesson_bundles_20260920', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Break the cycle, then drop
-- ---------------------------------------------------------------------------
ALTER TABLE public.curriculum_slots
  DROP CONSTRAINT curriculum_slots_lesson_id_fkey;

DROP TABLE public.lessons;
DROP TABLE public.lesson_bundles;

ALTER TABLE public.curriculum_slots DROP COLUMN lesson_id;
ALTER TABLE public.curriculum_slots DROP COLUMN is_vod_review;
ALTER TABLE public.curriculum_slots DROP COLUMN vod_url;
ALTER TABLE public.curriculum_slots DROP COLUMN vod_talking_points;

-- ---------------------------------------------------------------------------
-- 3. Read the result back. A migration that failed halfway still reads
--    correctly on disk, so assert against the catalog rather than trusting it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  problem TEXT;
BEGIN
  IF to_regclass('public.lessons') IS NOT NULL THEN
    problem := 'lessons table survived';
  ELSIF to_regclass('public.lesson_bundles') IS NOT NULL THEN
    problem := 'lesson_bundles table survived';
  ELSIF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_xor_vod') THEN
    problem := 'lesson_xor_vod constraint survived its columns';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'curriculum_slots'
      AND column_name IN ('lesson_id','is_vod_review','vod_url','vod_talking_points')
  ) THEN
    problem := 'a dropped curriculum_slots column survived';

  -- The keeps. These are the ones a careless CASCADE or a wrong column name
  -- would have taken, so they are asserted rather than assumed.
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'curriculum_slots'
      AND column_name = 'delivered_at'
  ) THEN
    problem := 'delivered_at was destroyed and it is load bearing';
  ELSIF to_regclass('public.vod_uploads') IS NULL THEN
    problem := 'vod_uploads was destroyed, that is the kid clip not the coach deliverable';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'cycle_lessons_delivered'
  ) THEN
    problem := 'cycle_lessons_delivered was destroyed and the billing cycle reads it';
  ELSIF to_regclass('public.derived_tasks_view') IS NULL THEN
    problem := 'derived_tasks_view was destroyed, which is Tim''s whole queue';
  END IF;

  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 5 read back wrong: %', problem;
  END IF;
END $$;

COMMIT;
