// OpenAI Whisper transcription helper.
//
// By the time a blob reaches this function it has already been processed
// by ffmpeg (in the transcribe route): it's always an audio/mpeg (MP3)
// file at 64kbps mono, well under the 25MB cap regardless of what
// Tim originally uploaded. The .mov repackaging logic from v1 is gone
// because ffmpeg normalizes everything upstream.
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
    return {
      ok: false,
      code: "file_too_large",
      detail: `${(fileBlob.size / 1024 / 1024).toFixed(1)}MB exceeds the 25MB Whisper limit.`,
    };
  }

  const form = new FormData();
  form.append("file", fileBlob, filename);
  form.append("model", WHISPER_MODEL);
  // Plain text response — no timestamps in the draft textarea.
  form.append("response_format", "text");

  console.log("[whisper] posting", {
    bytes: fileBlob.size,
    filename,
    mime: fileBlob.type,
  });

  try {
    const res = await fetch(WHISPER_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[whisper] non-2xx", { status: res.status, body: errText.slice(0, 500) });
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
    console.error("[whisper] fetch threw", { msg });
    return { ok: false, code: "network", detail: msg };
  }
}

// Normalize whitespace, preserve paragraph breaks, strip leaked timestamp
// markers like "[00:30]". Whisper plain-text mode doesn't include timestamps
// by default; the cleanup catches edge cases.
function postProcess(raw: string): string {
  let out = raw;
  out = out.replace(/\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/g, " ");
  out = out
    .split(/\r?\n\r?\n+/)
    .map((para) => para.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
  return out.trim();
}
