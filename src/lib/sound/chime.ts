// Brief synthesized "task completed" chime for Tim's admin.
//
// Uses the Web Audio API — no asset file, no network fetch. A short
// two-note major-sixth interval (C5 + A5) over ~180ms. Soft envelope
// so it lands as a confirmation, not a notification.
//
// Browser quirks worth knowing:
//   * AudioContext starts suspended in many browsers; we resume() on
//     first play. That requires a prior user gesture in the same tab,
//     which is always satisfied here because the chime fires AFTER the
//     user clicks a button (Reply / I welcomed them / Commented today).
//   * webkitAudioContext fallback for older Safari.
//   * iOS Safari may still ignore audio if the gesture chain is broken
//     across awaits. We keep the play path synchronous from the user
//     event.

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    return null;
  }
  return audioCtx;
}

export function playChime(): void {
  const ctx = getCtx();
  if (!ctx) return;

  // Resume if suspended. We don't await — the play path runs immediately
  // after resume() kicks off, which works in practice since the gesture
  // chain (user click → React state update → useEffect → playChime) is
  // tight.
  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const now = ctx.currentTime;
  // Major sixth interval, two octaves above middle C. Pleasant + brief.
  const freqs = [523.25, 880.0];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    // Quick attack, slower exponential decay — soft chime envelope.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }
}
