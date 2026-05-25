"use client";

// Step 1 video-upload + auto-transcribe UI.
//
// Drag-drop or file-picker. The file goes directly to the transcribe
// endpoint as multipart/form-data via XHR (not to Supabase Storage),
// so we get real upload-progress events. The server runs ffmpeg
// behind the scenes to extract audio before handing off to Whisper.
// All of that is invisible to Tim.
//
// UX flow: Upload X% → "Preparing video..." → Transcript ready
//
// No mention of codecs, file size limits, or conversion anywhere.

import { useRef, useState } from "react";
import styles from "./planner.module.css";

// 2 GB client-side sanity guard (covers any realistic coaching clip).
// The real size constraint is now audio-based on the server side.
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const ACCEPTED_EXT = [".mp4", ".mov", ".webm", ".m4a", ".mp3", ".wav", ".mpeg", ".mpga"];
const ACCEPTED_MIME = "video/mp4,video/quicktime,video/webm,audio/mp4,audio/mpeg,audio/wav,audio/webm";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string; pct: number }
  | { kind: "processing"; filename: string }
  | { kind: "ready"; filename: string; transcript: string; existingDraftLength: number }
  | { kind: "failed"; filename: string; reason: string };

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
  // Keep a ref to the active XHR so we could abort it if needed.
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  function reset() {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setPhase({ kind: "idle" });
  }

  async function handleFile(file: File) {
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED_EXT.includes(ext)) {
      setPhase({
        kind: "failed",
        filename: file.name,
        reason: `Unsupported format. Use ${ACCEPTED_EXT.join(", ")}.`,
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhase({
        kind: "failed",
        filename: file.name,
        reason: "File is too large. Use a shorter clip.",
      });
      return;
    }
    uploadAndTranscribe(file);
  }

  function uploadAndTranscribe(file: File) {
    setPhase({ kind: "uploading", filename: file.name, pct: 0 });

    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      if (pct >= 100) {
        // Upload done; server is now transcoding + transcribing.
        setPhase({ kind: "processing", filename: file.name });
      } else {
        setPhase({ kind: "uploading", filename: file.name, pct });
      }
    };

    xhr.onload = () => {
      xhrRef.current = null;
      let body: { ok?: boolean; transcript?: string; error?: string; detail?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = { error: `gateway_${xhr.status}`, detail: xhr.responseText.slice(0, 200) };
      }

      if (xhr.status < 200 || xhr.status >= 300 || !body.ok || !body.transcript) {
        const reason =
          body.error === "openai_not_configured"
            ? "Transcription is not configured yet. Paste manually for now."
            : body.detail || body.error || `Failed (HTTP ${xhr.status}).`;
        setPhase({ kind: "failed", filename: file.name, reason });
        return;
      }

      setPhase({
        kind: "ready",
        filename: file.name,
        transcript: body.transcript,
        existingDraftLength,
      });
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setPhase({ kind: "failed", filename: file.name, reason: "Network error." });
    };

    xhr.onabort = () => {
      xhrRef.current = null;
    };

    xhr.open("POST", `/api/admin/lessons/${lessonId}/transcribe`);
    xhr.send(form);
  }

  function commitTranscript(mode: "replace" | "append") {
    if (phase.kind !== "ready") return;
    onTranscript(phase.transcript, mode);
    reset();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (phase.kind === "uploading" || phase.kind === "processing") return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  // -------------------------------------------------------------------------
  // Render branches
  // -------------------------------------------------------------------------

  if (phase.kind === "uploading") {
    return (
      <div className={styles.uploaderActive}>
        <span className={styles.uploaderSpinner} />
        <div>
          <div className={styles.uploaderTitle}>Uploading {phase.filename}</div>
          <div className={styles.uploaderSub}>
            {phase.pct > 0 ? `${phase.pct}%` : "Starting..."}
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "processing") {
    return (
      <div className={styles.uploaderActive}>
        <span className={styles.uploaderSpinner} />
        <div>
          <div className={styles.uploaderTitle}>Preparing video...</div>
          <div className={styles.uploaderSub}>
            Whisper is listening. This usually takes 30 to 60 seconds.
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
          <span>Transcribed</span>
          <span className={styles.uploaderSub}>{phase.filename}</span>
        </div>
        <div className={styles.uploaderPreview}>
          {phase.transcript.slice(0, 220)}
          {phase.transcript.length > 220 ? "..." : ""}
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

  if (phase.kind === "failed") {
    return (
      <div className={styles.uploaderError}>
        <div className={styles.uploaderErrorTitle}>Could not transcribe</div>
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

  // idle — drop zone
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
          if (e.target) e.target.value = "";
        }}
      />
      <div className={styles.uploaderHero}>Drag a video here, or click to choose</div>
      <div className={styles.uploaderSub}>
        MP4, MOV, WebM and more. We auto transcribe with Whisper.
      </div>
    </div>
  );
}
