// Edge Function — rough_draft_cleanup
//
// Fires daily. Deletes rough-draft video files (under
// `lesson-assets/rough-drafts/<lesson_id>/...`) older than 24 hours.
//
// Why 24 hours: after Whisper transcribes the file, the transcript is
// in planner_state.roughDraft and persisted. The source video itself
// is no longer load-bearing. But we keep it briefly so if the
// transcript came out wrong, Tim can retry without re-uploading.
//
// Idempotent: deletes by created_at filter so re-running on a clean
// state is a no-op.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RETENTION_HOURS = 24;
const BUCKET = "lesson-assets";
const PREFIX = "rough-drafts";

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

  // Walk rough-drafts/<lesson_id>/ subfolders. Supabase Storage list
  // is non-recursive — list each lesson folder explicitly.
  const lessonsList = await supabase.storage.from(BUCKET).list(PREFIX, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (lessonsList.error) {
    console.error("[cron-rough-draft-cleanup] list lesson folders failed", lessonsList.error);
    return new Response(lessonsList.error.message, { status: 500 });
  }

  let deleted = 0;
  let scanned = 0;
  const errors: string[] = [];

  for (const folder of lessonsList.data ?? []) {
    const folderPath = `${PREFIX}/${folder.name}`;
    const filesList = await supabase.storage.from(BUCKET).list(folderPath, {
      limit: 1000,
    });
    if (filesList.error) {
      errors.push(`${folder.name}: ${filesList.error.message}`);
      continue;
    }
    const toDelete: string[] = [];
    for (const file of filesList.data ?? []) {
      scanned++;
      // Storage list returns ISO created_at on file objects.
      const createdAt = file.created_at ? new Date(file.created_at) : null;
      if (!createdAt) continue;
      if (createdAt < cutoff) {
        toDelete.push(`${folderPath}/${file.name}`);
      }
    }
    if (toDelete.length > 0) {
      const del = await supabase.storage.from(BUCKET).remove(toDelete);
      if (del.error) {
        errors.push(`${folder.name} delete: ${del.error.message}`);
      } else {
        deleted += toDelete.length;
      }
    }
  }

  return new Response(
    JSON.stringify({ scanned, deleted, retention_hours: RETENTION_HOURS, errors }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
