"use client";

// One-time explainer modal that surfaces on the first dashboard visit
// after 10 seconds. Tells the user they don't need to magic-link in
// every time. Stores a dismissed flag in localStorage so it never
// shows again on this browser.
//
// Per-role keys would be needed if we want the modal to fire separately
// for parent, kid, and coach. For MVP just one shared key — if a user
// is dual-role (rare) they only see it once.

import { useEffect, useState } from "react";
import styles from "./session-modal.module.css";

const STORAGE_KEY = "xpl_session_modal_dismissed_v1";
const SHOW_AFTER_MS = 10_000;

export default function SessionPersistenceModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Skip if already dismissed.
    try {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      // localStorage unavailable (private mode in some browsers). Fall
      // through — better to show the explainer than fail silently.
    }
    const t = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.card}>
        <div className={styles.eyebrow}>Heads up</div>
        <h3 className={styles.title}>Stay signed in automatically</h3>
        <p className={styles.body}>
          As long as you open your dashboard at least once a week,
          you&apos;ll stay signed in on this device.
        </p>
        <p className={styles.body}>You may need to sign in again if:</p>
        <ul className={styles.list}>
          <li>you haven&apos;t visited in about a week,</li>
          <li>you sign out manually, or</li>
          <li>you clear your browser cookies or switch devices/browsers.</li>
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={dismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
