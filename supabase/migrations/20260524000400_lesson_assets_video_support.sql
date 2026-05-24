-- Widen the lesson-assets bucket to accept video uploads for the
-- Step 1 transcribe-from-video flow. Whisper's per-request cap is
-- 25MB; we set the bucket cap to ~26MB so client uploads at the
-- bucket boundary get rejected by Whisper (with a clear error) rather
-- than by storage at upload time.

BEGIN;

UPDATE storage.buckets
SET
  file_size_limit = 27262976,  -- 26 MB
  allowed_mime_types = ARRAY[
    -- Existing slide/audio types
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/x-m4a',
    'audio/webm',
    -- New: video formats for rough-draft transcription
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v'
  ]
WHERE id = 'lesson-assets';

COMMIT;
