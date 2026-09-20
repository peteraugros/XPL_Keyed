-- Retires the `lesson-assets` storage bucket (2026-09-20).
--
-- The tail of Phase 5. The tables went in 20260920000000; this is the file
-- store they pointed at. Kept separate on purpose: that was a decision about
-- SCHEMA, this is a decision about FILES, and the two deserve to be revertible
-- apart.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION CAN AND CANNOT DO
-- ---------------------------------------------------------------------------
-- It drops the policy. It does NOT drop the bucket, because it cannot:
--
--   ERROR: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead. (SQLSTATE 42501)
--
-- Supabase enforces that with the `protect_buckets_delete` and
-- `protect_objects_delete` triggers. Buckets and objects are API managed, and
-- that is correct rather than an obstacle: deleting rows from storage.objects
-- in SQL would remove the METADATA and orphan the actual blobs in the storage
-- backend, where they bill forever and appear in no listing.
--
-- So the bucket and its six objects were removed through the Storage REST API
-- on 2026-09-20, against BOTH local and production, and read back at zero.
-- What is left here is the one piece that genuinely belongs in the schema.
--
-- ⚠️ A fresh `supabase db reset` WILL recreate the bucket, because
-- 20260518000000 inserts it and applied migrations are never rewritten. It
-- comes back empty and, thanks to this file, with no policy on it: inert, and
-- not worth corrupting migration history to prevent.
--
-- ---------------------------------------------------------------------------
-- WHY DELETING THE FILES WAS SAFE, established by looking rather than assuming
-- ---------------------------------------------------------------------------
-- Nothing in `src` has referenced this bucket since Phase 4 removed the
-- planner, the uploader and the transcribe route.
--
-- It was not empty in production, and the first note written about it in
-- CLAUDE.md called its contents "Tim's real slide, audio and video files".
-- That was an overstatement, corrected by listing them:
--
--   6 objects, all under rough-drafts/, all dated 2026-05-24, and by sha256
--   only TWO DISTINCT FILES ; one 11.4 MB .mov stored four times and its
--   1.2 MB .mp4 transcode stored twice. 48 MB holding 12.6 MB of content.
--
-- One clip re-uploaded while the transcribe pipeline was being built, not
-- lesson material. 20260524000300 had already classified exactly these as
-- disposable in as many words: deletable after 24h, because "the transcript
-- lives in planner_state and the source video is no longer load-bearing".
-- They were downloaded and hashed before anything was deleted.
--
-- ⚠️ AND A CLI TRAP WORTH KNOWING: `supabase storage rm`, at CLI 2.117.0,
-- answered `{"deleted":[]}` with an empty message and deleted NOTHING, both
-- for a recursive prefix and for a single explicit file path. It reports
-- success either way. The REST endpoint works. Verify a storage deletion by
-- counting what is left, never by reading the command's own summary.

BEGIN;

-- The bucket's only policy. Coach full access, added by 20260518000000.
-- Nothing has needed it since Phase 4.
DROP POLICY IF EXISTS lesson_assets_coach_all ON storage.objects;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND policyname = 'lesson_assets_coach_all'
  ) THEN
    RAISE EXCEPTION 'lesson_assets_coach_all survived its own removal';
  END IF;
END $$;

COMMIT;
