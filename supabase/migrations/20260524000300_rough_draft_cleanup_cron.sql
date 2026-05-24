-- Daily cleanup of rough-draft video files in lesson-assets/rough-drafts/
-- Runs at 18:00 UTC. Deletes files older than 24h (Whisper has already
-- transcribed them; the transcript lives in planner_state and the
-- source video is no longer load-bearing).

BEGIN;

SELECT cron.schedule(
  'cron-rough-draft-cleanup',
  '0 18 * * *',
  $$
  SELECT cron_fire('cron-rough-draft-cleanup');
  $$
);

COMMIT;
