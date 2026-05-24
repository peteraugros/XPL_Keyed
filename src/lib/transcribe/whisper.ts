// OpenAI Whisper transcription helper.
//
// Whisper API accepts video files directly (mp4, mov, webm, m4a, mp3,
// wav, etc) up to 25MB per request. Hit the API once per file, return
// the plain text transcript. Per-file size + format validation is the
// caller's responsibility — we surface API errors verbatim if Whisper
// rejects.
//
// Cost: $0.006/min audio. A 5-minute coaching clip costs ~$0.03.

const WHISPER_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export type TranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; code: string; detail?: string };

export async function transcribeAudio(
  fileBlob: Blob,
  filename: string,
): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, code: "openai_not_configured" };
  }
  if (fileBlob.size > WHISPER_MAX_BYTES) {
    return { ok: false, code: "file_too_large", detail: `${(fileBlob.size / 1024 / 1024).toFixed(1)}MB exceeds the 25MB Whisper limit.` };
  }

  // Whisper's officially-supported extensions: mp3, mp4, mpeg, mpga,
  // m4a, wav, webm. .mov files (Mac screen recordings default to this)
  // share the ISO base media file format with mp4 at the byte level,
  // so the data parses fine — but Whisper's parser refuses to ingest
  // anything tagged with a QuickTime MIME. Tested 2026-05-24: even
  // renaming the filename to .mp4 isn't enough; the Blob's `type`
  // property (e.g. "video/quicktime") leaks into the FormData
  // multipart header and Whisper rejects on that.
  //
  // Fix: repackage the blob with a video/mp4 MIME type AND a .mp4
  // filename. The underlying bytes are unchanged; we're just changing
  // the labels so Whisper's content-type sniff accepts it. Works for
  // every .mov screen recording I've thrown at it.
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const whisperFilename =
    ext === "mov" ? filename.replace(/\.mov$/i, ".mp4") : filename;
  const whisperMime = ext === "mov" ? "video/mp4" : (fileBlob.type || "video/mp4");
  const repackaged = new Blob([await fileBlob.arrayBuffer()], { type: whisperMime });

  const form = new FormData();
  form.append("file", repackaged, whisperFilename);
  form.append("model", WHISPER_MODEL);
  // Plain text response — no timestamps. We surface the raw text to
  // Tim; the planner textarea isn't the place for timecode metadata.
  form.append("response_format", "text");

  console.log("[whisper] posting to Whisper", {
    bytes: fileBlob.size,
    filename: whisperFilename,
    original_ext: ext,
    original_mime: fileBlob.type,
    repackaged_mime: whisperMime,
  });

  try {
    const res = await fetch(WHISPER_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[whisper] non-2xx response", {
        status: res.status,
        body: errText.slice(0, 500),
      });
      return {
        ok: false,
        code: res.status === 401 ? "invalid_key" : "whisper_api_error",
        detail: `Whisper ${res.status}: ${errText.slice(0, 300)}`,
      };
    }
    const raw = await res.text();
    console.log("[whisper] success", { transcript_chars: raw.length });
    return { ok: true, transcript: postProcess(raw) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[whisper] fetch threw", { msg, err });
    return { ok: false, code: "network", detail: msg };
  }
}

// Lightweight post-processing. Per Peter's note: normalize whitespace,
// preserve paragraph breaks, strip leaked timestamp markers like
// "[00:30]" or "00:00:30". Whisper's plain-text mode doesn't include
// timestamps by default but defensive cleaning catches edge cases.
function postProcess(raw: string): string {
  let out = raw;
  // Strip [HH:MM:SS] or [MM:SS] markers
  out = out.replace(/\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/g, " ");
  // Collapse runs of whitespace within a line, preserve paragraph breaks
  out = out
    .split(/\r?\n\r?\n+/)
    .map((para) => para.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
  return out.trim();
}
