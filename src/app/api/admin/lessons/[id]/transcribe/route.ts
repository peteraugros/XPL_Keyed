// POST /api/admin/lessons/[id]/transcribe
//
// Coach-gated. Accepts multipart/form-data with a single "file" field.
// Streams the upload to a temp file via busboy (no memory buffering for
// large ProRes/MOV files). Runs ffmpeg to extract audio-only at 64kbps
// mono, then posts the audio to OpenAI Whisper for transcription.
//
// All of this is invisible to Tim. He drags a file, sees a progress bar,
// then "Preparing video...", then the transcript lands. No mention of
// codecs, size limits, or conversion.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/transcribe/whisper";
import Busboy from "busboy";
import { Readable } from "stream";
import { tmpdir } from "os";
import { join } from "path";
import { createWriteStream } from "fs";
import { unlink, stat, readFile } from "fs/promises";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ffmpeg transcode + Whisper can take 2-3 min on a large file.
export const maxDuration = 300;

// Fallback to audio-only encoding at lower bitrate if 64kbps output
// somehow still exceeds Whisper's cap (extremely long recordings only).
async function extractAudio(
  inputPath: string,
  outputPath: string,
  bitrate = "64k",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      "-y",                        // overwrite output without prompting
      "-i", inputPath,
      "-vn",                       // strip video track
      "-acodec", "libmp3lame",
      "-ac", "1",                  // mono — halves file size vs stereo
      "-ar", "16000",              // 16kHz — Whisper's native rate
      "-b:a", bitrate,
      outputPath,
    ];
    const proc = spawn(ffmpegPath as string, args);
    const stderrLines: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderrLines.push(chunk.toString()));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `ffmpeg exited ${code}: ${stderrLines.slice(-3).join("").slice(0, 300)}`,
        ));
      }
    });
    proc.on("error", (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: lessonId } = await ctx.params;

  // Auth: must be an active coach.
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

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "expected_multipart" }, { status: 400 });
  }

  const uid = randomUUID();
  const rawPath = join(tmpdir(), `xpl-raw-${uid}`);
  const audioPath = join(tmpdir(), `xpl-audio-${uid}.mp3`);

  try {
    // ----------------------------------------------------------------
    // Phase 1: stream the upload to a temp file (no memory buffering).
    // busboy reads from the Web ReadableStream, writes to disk.
    // ----------------------------------------------------------------
    let originalFilename = "upload";
    await new Promise<void>((resolve, reject) => {
      const bb = Busboy({ headers: { "content-type": contentType } });
      let fileReceived = false;

      bb.on("file", (_field, fileStream, info) => {
        fileReceived = true;
        originalFilename = info.filename || "upload";
        console.log("[transcribe] receiving", {
          lessonId,
          filename: info.filename,
          mime: info.mimeType,
        });
        const ws = createWriteStream(rawPath);
        fileStream.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
        fileStream.on("error", reject);
      });

      bb.on("error", reject);
      bb.on("finish", () => {
        if (!fileReceived) reject(new Error("no_file_field"));
      });

      // Convert the Web ReadableStream to a Node.js Readable for busboy.
      if (!req.body) {
        reject(new Error("no_body"));
        return;
      }
      Readable.fromWeb(req.body as import("stream/web").ReadableStream).pipe(bb);
    });

    const rawStats = await stat(rawPath);
    console.log("[transcribe] raw file saved", { bytes: rawStats.size, filename: originalFilename });

    // ----------------------------------------------------------------
    // Phase 2: extract audio-only with ffmpeg.
    // ProRes/uncompressed MOV can be 500MB+ but the audio track at
    // 64kbps mono is ~1.5MB for a 3-minute clip. This keeps Whisper
    // well under its 25MB cap regardless of input format.
    // ----------------------------------------------------------------
    console.log("[transcribe] extracting audio via ffmpeg");
    await extractAudio(rawPath, audioPath, "64k");

    const audioStats = await stat(audioPath);
    console.log("[transcribe] audio ready", { bytes: audioStats.size });

    // Whisper cap is 25MB. If the audio is somehow still too large
    // (extremely long recording), retry at 32kbps.
    const WHISPER_CAP = 24 * 1024 * 1024;
    if (audioStats.size > WHISPER_CAP) {
      console.log("[transcribe] audio exceeds cap at 64k, retrying at 32k");
      await unlink(audioPath).catch(() => {});
      await extractAudio(rawPath, audioPath, "32k");
      const retryStats = await stat(audioPath);
      console.log("[transcribe] audio re-encoded at 32k", { bytes: retryStats.size });
    }

    // ----------------------------------------------------------------
    // Phase 3: send the audio blob to Whisper.
    // ----------------------------------------------------------------
    const audioBuffer = await readFile(audioPath);
    const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

    const result = await transcribeAudio(audioBlob, "audio.mp3");
    if (!result.ok) {
      console.error("[transcribe] whisper failed", result);
      return NextResponse.json(
        { error: result.code, detail: result.detail ?? "" },
        { status: result.code === "openai_not_configured" ? 503 : 502 },
      );
    }

    console.log("[transcribe] success", {
      input_bytes: rawStats.size,
      audio_bytes: audioStats.size,
      transcript_chars: result.transcript.length,
    });
    return NextResponse.json({ ok: true, transcript: result.transcript });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[transcribe] unhandled error", { msg, stack });
    return NextResponse.json(
      { error: "handler_threw", detail: msg },
      { status: 500 },
    );
  } finally {
    // Always clean up temp files, even on error.
    await unlink(rawPath).catch(() => {});
    await unlink(audioPath).catch(() => {});
  }
}
