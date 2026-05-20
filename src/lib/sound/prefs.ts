// localStorage-backed sound preference for /admin.
//
// Default ON, but respects prefers-reduced-motion as a defensive
// default-off for users who've explicitly opted out of motion/sound
// effects at the OS level.
//
// Key: `xpl-admin-sound`. Value: "1" (on) | "0" (off). Absent =
// follow the system preference.

const KEY = "xpl-admin-sound";

export function getSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  // Unset — default on unless reduced-motion is set.
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, enabled ? "1" : "0");
}

// Custom event name we fire on toggle so the header button and any
// listeners stay in sync without a full state library.
export const SOUND_PREF_EVENT = "xpl-admin-sound-changed";
