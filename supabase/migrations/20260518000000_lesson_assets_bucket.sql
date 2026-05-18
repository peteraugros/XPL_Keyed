-- ============================================================================
-- XPL Keyed — Lesson assets storage bucket
-- ============================================================================
-- Private Supabase Storage bucket for lesson slide PNGs + audio MP3s.
--
-- Access posture:
--   * Coach has full read/write/delete via storage.objects RLS.
--   * Parents and players never touch storage directly. The app serves
--     lesson assets via signed URLs minted server-side after the normal
--     family-id RLS check passes.
--   * Bucket is `public=false` so direct URLs don't leak.
--
-- File naming convention (enforced in the upload route, not at the DB):
--   lesson-assets/lessons/<lesson_id>/slide-<n>.png
--   lesson-assets/lessons/<lesson_id>/slide-<n>.mp3
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lesson-assets',
  'lesson-assets',
  FALSE,
  10485760,  -- 10 MB per file. Slide PNGs are usually under 1MB, MP3s vary.
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',  -- MP3 (QuickTime exports usually emit this)
    'audio/mp4',
    'audio/wav',
    'audio/x-m4a'
  ]
)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- RLS on storage.objects (storage already has RLS enabled by Supabase)
-- ---------------------------------------------------------------------------
-- Coach full access on this bucket. is_coach() lives in public schema.
CREATE POLICY lesson_assets_coach_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'lesson-assets' AND public.is_coach())
  WITH CHECK (bucket_id = 'lesson-assets' AND public.is_coach());

-- No SELECT policy for non-coach. Parents/players access via signed URLs
-- minted server-side; signed URLs bypass RLS by design.
