-- Lesson planner Path B (video-first, lean).
--
-- Background: the originally-authored slide+audio lesson model is
-- replaced by a video-first model. Tim plans via the new 7-step planner,
-- records video, pastes URL. Sunday delivery links to the video.
--
-- This migration:
--   1. Makes the slide-era required fields nullable so a lesson row can
--      be created at Step 1 of the planner before any of them are
--      filled in. Tim populates them progressively, locks them at
--      publish time.
--   2. Adds video_url (the URL Tim pastes — YouTube, Vimeo, Loom, etc).
--   3. Adds beat_sheet JSONB (hook/goal/breakdown/etc — read by Sunday
--      cron + lesson viewer).
--   4. Adds terms JSONB (glossary — also read by Sunday cron).
--   5. Adds planner_state JSONB for the rest of the editor state
--      (rough_draft, watch_notes, identify_list, dependency flags,
--      retrospectives, review checks, current_step). Only the planner
--      UI reads this; no cron or viewer touches it.
--
-- Existing 4 lessons keep their slide content. They render in admin as
-- "Missing video" until Tim adds a video_url or rebuilds them through
-- the planner. Nothing auto-deletes. The slides column stays for now;
-- a follow-up migration drops it once no lesson references it.

BEGIN;

-- 1. Loosen the strict NOT NULLs so a new planner-state lesson can be
-- inserted at Step 1 with just title + author.
ALTER TABLE lessons ALTER COLUMN slides DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN fortnite_label DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN parent_label DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN parent_skill_description DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN topic DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN difficulty_level DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN duration_minutes DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN parent_talking_points DROP NOT NULL;

-- 2-5. New columns.
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS beat_sheet JSONB;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS terms JSONB;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS planner_state JSONB;

-- Partial index: surfaces planner-state lessons that are ready to ship
-- (video URL set + published). Used by the Sunday delivery cron + the
-- /admin/lessons "Published" filter.
CREATE INDEX IF NOT EXISTS idx_lessons_published_with_video
  ON lessons(is_published) WHERE is_published = TRUE AND video_url IS NOT NULL;

COMMIT;
