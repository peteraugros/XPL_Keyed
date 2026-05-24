// POST /api/admin/lessons/[id]/transcribe
//
// Coach-gated. Body: { storage_path: string }.
// Downloads the rough-draft video from Supabase Storage server-side,
// posts to OpenAI Whisper, returns the transcript text.
//
// The file is NOT deleted here — cron-rough-draft-cleanup handles
// 24-hour retention so failed transcriptions are retryable without
// re-upload. Caller writes the transcript into planner_state.roughDraft
// via the existing PATCH /api/admin/lessons/[id] endpoint.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { transcribeAudio, WHISPER_MAX_BYTES } from "@/lib/transcribe/whisper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Whisper can take 30-60 seconds for a 25MB file. Bump max duration
// past the Next.js default so the request doesn't time out.
export const maxDuration = 120;

const bodySchema = z.object({
  storage_path: z.string().min(1).max(500),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: lessonId } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const coachRow = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  const coach = coachRow.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Defensive: the storage_path must be inside the lesson's own
  // rough-drafts folder. Prevents a coach (or a token leak) from
  // pointing transcribe at an arbitrary file in the bucket.
  const expectedPrefix = `rough-drafts/${lessonId}/`;
  if (!body.storage_path.startsWith(expectedPrefix)) {
    return NextResponse.json(
      { error: "storage_path_outside_lesson", detail: "Path must be under " + expectedPrefix },
      { status: 400 },
    );
  }

  const service = createServiceRoleClient();
  const dl = await service.storage.from("lesson-assets").download(body.storage_path);
  if (dl.error || !dl.data) {
    console.error("[transcribe] storage download failed", dl.error);
    return NextResponse.json(
      { error: "file_not_found", detail: dl.error?.message ?? "" },
      { status: 404 },
    );
  }

  const blob = dl.data;
  if (blob.size > WHISPER_MAX_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        detail: `${(blob.size / 1024 / 1024).toFixed(1)}MB exceeds the 25MB Whisper limit. Try a shorter clip.`,
      },
      { status: 413 },
    );
  }

  // Whisper accepts the path's basename as the filename hint. Strip the
  // UUID prefix and keep just the visible file name.
  const basename = body.storage_path.split("/").pop() ?? "audio.mp4";
  const result = await transcribeAudio(blob, basename);

  if (!result.ok) {
    // Don't delete the file on failure — Tim can retry without
    // re-uploading. The 24hr cleanup cron will purge eventually.
    return NextResponse.json(
      { error: result.code, detail: result.detail ?? "" },
      { status: result.code === "openai_not_configured" ? 503 : 502 },
    );
  }

  return NextResponse.json({ ok: true, transcript: result.transcript });
}
