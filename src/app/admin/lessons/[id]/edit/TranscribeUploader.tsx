"use client";

// Step 1 video-upload + auto-transcribe UI. Drag-drop or file-picker;
// validates size client-side; uploads directly to Supabase Storage
// via the cookie-bound client (coach RLS on lesson-assets bucket);
// calls /api/admin/lessons/[id]/transcribe; surfaces upload + transcribe
// status separately; on success, hands the transcript back to the
// parent. If the parent's existing rough_draft has content, asks
// replace-vs-append before insertion.
//
// Out of scope for v1 (per spec): chunked upload for >25MB, true
// upload-percentage during the PUT (Supabase JS upload doesn't
// expose progress on the browser side; we show indeterminate
// "Uploading..." instead), pause/resume, async job queue.

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./planner.module.css";

const MAX_BYTES = 25 * 1024 * 1024; // Mirrors Whisper's per-request cap.
const ACCEPTED_EXT = [".mp4", ".mov", ".webm", ".m4a", ".mp3", ".wav", ".mpeg", ".mpga"];
const ACCEPTED_MIME = "video/mp4,video/quicktime,video/webm,audio/mp4,audio/mpeg,audio/wav,audio/webm";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string; bytes: number }
  | { kind: "transcribing"; filename: string; storagePath: string }
  | { kind: "ready"; filename: string; transcript: string; existingDraftLength: number }
  | { kind: "upload_failed"; filename: string; reason: string }
  | { kind: "transcribe_failed"; filename: string; storagePath: string; reason: string };

export default function TranscribeUploader({
  lessonId,
  existingDraftLength,
  onTranscript,
}: {
  lessonId: string;
  existingDraftLength: number;
  onTranscript: (transcript: string, mode: "replace" | "append") => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setPhase({ kind: "idle" });
  }

  async function handleFile(file: File) {
    // Size guard (client-side: avoid uploading 100MB before the server
    // rejects it). Format guard: extension OR mime — extension wins
    // because some browsers report empty mime for mp4.
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED_EXT.includes(ext)) {
      setPhase({
        kind: "upload_failed",
        filename: file.name,
        reason: `Unsupported format. Use ${ACCEPTED_EXT.join(", ")}.`,
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhase({
        kind: "upload_failed",
        filename: file.name,
        reason: `${(file.size / 1024 / 1024).toFixed(1)}MB exceeds 25MB. Trim or compress the clip.`,
      });
      return;
    }

    await uploadAndTranscribe(file);
  }

  async function uploadAndTranscribe(file: File) {
    setPhase({ kind: "uploading", filename: file.name, bytes: file.size });

    const supabase = createClient();
    const ext = "." + (file.name.split(".").pop() ?? "mp4").toLowerCase();
    const objectPath = `rough-drafts/${lessonId}/${crypto.randomUUID()}${ext}`;

    const up = await supabase.storage
      .from("lesson-assets")
      .upload(objectPath, file, {
        cacheControl: "0",
        upsert: false,
        contentType: file.type || "video/mp4",
      });
    if (up.error) {
      console.error("[uploader] storage upload failed", up.error);
      setPhase({
        kind: "upload_failed",
        filename: file.name,
        reason: up.error.message || "Upload failed.",
      });
      return;
    }

    setPhase({
      kind: "transcribing",
      filename: file.name,
      storagePath: objectPath,
    });

    try {
      const res = await fetch(`/api/admin/lessons/${lessonId}/transcribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storage_path: objectPath }),
      });
      // Read body once. JSON parse failure → fall back to status code +
      // a hint so the UI never shows the bare "Transcription failed."
      // string. That string used to hide Railway gateway errors that
      // had HTML bodies instead of our JSON.
      let body: { ok?: boolean; transcript?: string; error?: string; detail?: string } = {};
      const raw = await res.text();
      try {
        body = JSON.parse(raw);
      } catch {
        body = { error: `gateway_${res.status}`, detail: raw.slice(0, 200) };
      }
      if (!res.ok || !body.ok || !body.transcript) {
        const reason =
          body.error === "openai_not_configured"
            ? "Transcription is not configured yet. Paste manually for now."
            : body.detail || body.error || `Transcription failed (HTTP ${res.status}).`;
        setPhase({
          kind: "transcribe_failed",
          filename: file.name,
          storagePath: objectPath,
          reason,
        });
        return;
      }
      setPhase({
        kind: "ready",
        filename: file.name,
        transcript: body.transcript,
        existingDraftLength,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network";
      setPhase({
        kind: "transcribe_failed",
        filename: file.name,
        storagePath: objectPath,
        reason: msg,
      });
    }
  }

  async function retryTranscribe() {
    if (phase.kind !== "transcribe_failed") return;
    setPhase({
      kind: "transcribing",
      filename: phase.filename,
      storagePath: phase.storagePath,
    });
    try {
      const res = await fetch(`/api/admin/lessons/${lessonId}/transcribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storage_path: phase.storagePath }),
      });
      let body: { ok?: boolean; transcript?: string; error?: string; detail?: string } = {};
      const raw = await res.text();
      try {
        body = JSON.parse(raw);
      } catch {
        body = { error: `gateway_${res.status}`, detail: raw.slice(0, 200) };
      }
      if (!res.ok || !body.ok || !body.transcript) {
        setPhase({
          kind: "transcribe_failed",
          filename: phase.filename,
          storagePath: phase.storagePath,
          reason: body.detail || body.error || `Transcription failed (HTTP ${res.status}).`,
        });
        return;
      }
      setPhase({
        kind: "ready",
        filename: phase.filename,
        transcript: body.transcript,
        existingDraftLength,
      });
    } catch {
      setPhase({
        kind: "transcribe_failed",
        filename: phase.filename,
        storagePath: phase.storagePath,
        reason: "Network error on retry.",
      });
    }
  }

  function commitTranscript(mode: "replace" | "append") {
    if (phase.kind !== "ready") return;
    onTranscript(phase.transcript, mode);
    reset();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (phase.kind === "uploading" || phase.kind === "transcribing") return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  // -----------------------------------------------------------------------
  // Render branches
  // -----------------------------------------------------------------------

  if (phase.kind === "uploading") {
    return (
      <div className={styles.uploaderActive}>
        <span className={styles.uploaderSpinner} />
        <div>
          <div className={styles.uploaderTitle}>Uploading {phase.filename}</div>
          <div className={styles.uploaderSub}>
            {(phase.bytes / 1024 / 1024).toFixed(1)}MB. Don&apos;t close the tab.
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "transcribing") {
    return (
      <div className={styles.uploaderActive}>
        <span className={styles.uploaderSpinner} />
        <div>
          <div className={styles.uploaderTitle}>Transcribing {phase.filename}</div>
          <div className={styles.uploaderSub}>
            Whisper is listening. Usually 30-60 seconds.
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "ready") {
    const hasExisting = phase.existingDraftLength > 0;
    return (
      <div className={styles.uploaderReady}>
        <div className={styles.uploaderReadyHeader}>
          <span>✓ Transcribed</span>
          <span className={styles.uploaderSub}>{phase.filename}</span>
        </div>
        <div className={styles.uploaderPreview}>
          {phase.transcript.slice(0, 220)}
          {phase.transcript.length > 220 ? "…" : ""}
        </div>
        {hasExisting ? (
          <>
            <p className={styles.uploaderQuestion}>
              Your draft already has content. What do you want to do?
            </p>
            <div className={styles.uploaderActions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => commitTranscript("append")}
              >
                Append to existing
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => commitTranscript("replace")}
              >
                Replace existing
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={reset}
              >
                Discard
              </button>
            </div>
          </>
        ) : (
          <div className={styles.uploaderActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => commitTranscript("replace")}
            >
              Use this transcript
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={reset}
            >
              Discard
            </button>
          </div>
        )}
      </div>
    );
  }

  if (phase.kind === "upload_failed") {
    return (
      <div className={styles.uploaderError}>
        <div className={styles.uploaderErrorTitle}>Upload failed</div>
        <div className={styles.uploaderSub}>{phase.reason}</div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost} ${styles.btnTiny}`}
          onClick={reset}
          style={{ marginTop: 8 }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase.kind === "transcribe_failed") {
    return (
      <div className={styles.uploaderError}>
        <div className={styles.uploaderErrorTitle}>Transcription failed</div>
        <div className={styles.uploaderSub}>{phase.reason}</div>
        <div className={styles.uploaderActions} style={{ marginTop: 8 }}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost} ${styles.btnTiny}`}
            onClick={retryTranscribe}
          >
            Retry transcription
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost} ${styles.btnTiny}`}
            onClick={reset}
          >
            Cancel
          </button>
        </div>
        <div className={styles.uploaderSub} style={{ marginTop: 6 }}>
          The video stays in our temporary storage for 24h so you can retry.
        </div>
      </div>
    );
  }

  // idle — show the drop zone.
  return (
    <div
      className={`${styles.uploader} ${isDragOver ? styles.uploaderDragOver : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MIME + "," + ACCEPTED_EXT.join(",")}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          // Clear so picking the same file again re-fires onChange.
          if (e.target) e.target.value = "";
        }}
      />
      <div className={styles.uploaderHero}>
        Drag a video here, or click to choose
      </div>
      <div className={styles.uploaderSub}>
        MP4, MOV, WebM, M4A up to 25MB. We auto transcribe with Whisper.
      </div>
    </div>
  );
}
