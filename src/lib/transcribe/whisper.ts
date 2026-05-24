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

  const form = new FormData();
  form.append("file", fileBlob, filename);
  form.append("model", WHISPER_MODEL);
  // Plain text response — no timestamps. We surface the raw text to
  // Tim; the planner textarea isn't the place for timecode metadata.
  form.append("response_format", "text");

  try {
    const res = await fetch(WHISPER_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[whisper] non-2xx response", res.status, errText);
      return {
        ok: false,
        code: res.status === 401 ? "invalid_key" : "whisper_api_error",
        detail: `${res.status} ${errText.slice(0, 200)}`,
      };
    }
    const raw = await res.text();
    return { ok: true, transcript: postProcess(raw) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[whisper] fetch threw", msg);
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
