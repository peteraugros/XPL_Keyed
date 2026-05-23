"use client";

// Single-session post-payment celebration. Mirrors /intake's
// SuccessCard treatment: ACHIEVEMENT UNLOCKED kicker, pulse-animated
// headline, confetti burst, success chime if sound was on during the
// form. Reads sound preference from the same SOUND_STORAGE_KEY that
// SingleSessionClient persists, so the chime fires only if the parent
// had sound enabled during the 4-level flow.

import { useEffect, useRef } from "react";
import shell from "../../intake/page.module.css";
import pay from "../page.module.css";

const SOUND_STORAGE_KEY = "xpl-single-session-sound";
const SUCCESS_NOTES = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

function playSuccessChime(ctxRef: { current: AudioContext | null }) {
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  if (!ctxRef.current) ctxRef.current = new Ctx();
  const ctx = ctxRef.current;
  const now = ctx.currentTime;
  SUCCESS_NOTES.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const start = now + i * 0.085;
    const dur = 0.14;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.start(start);
    osc.stop(start + dur);
  });
}

export default function SuccessClient({
  parentEmail,
}: {
  parentEmail: string | null;
}) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    // Chime — only if the parent had sound on during the form.
    let soundOn = false;
    try {
      soundOn = window.localStorage.getItem(SOUND_STORAGE_KEY) === "on";
    } catch {
      /* ignore */
    }
    if (soundOn) playSuccessChime(audioCtxRef);

    // Confetti — skip if reduced-motion is requested.
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    void import("canvas-confetti").then(({ default: confetti }) => {
      const burst = (origin: { x: number; y: number }) => {
        confetti({
          particleCount: 90,
          spread: 70,
          startVelocity: 45,
          ticks: 240,
          origin,
          colors: ["#C7FF3D", "#4C51F7", "#F5A623", "#319236"],
          scalar: 1.05,
        });
      };
      burst({ x: 0.2, y: 0.55 });
      burst({ x: 0.8, y: 0.55 });
      window.setTimeout(() => burst({ x: 0.5, y: 0.35 }), 220);
    });
  }, []);

  return (
    <main className={shell.shell}>
      <div className={shell.frame}>
        <div className={shell.card}>
          <div className={shell.successCard}>
            <div className={shell.unlockedKicker}>ACHIEVEMENT UNLOCKED</div>
            <h2 className={shell.unlockedHeadline}>Session Booked</h2>
            <p className={shell.successBody}>
              Payment received.{" "}
              {parentEmail ? (
                <>
                  We emailed you at <b>{parentEmail}</b> with a one tap sign
                  in link.
                </>
              ) : (
                <>
                  A one tap sign in link is on its way to the email you used
                  at checkout.
                </>
              )}{" "}
              Tap it and your scheduling page opens.
            </p>
            <span className={shell.successDetail}>
              From there you pick the time that works. Tim sends the Discord
              invite before the call. Check spam if the email isn&apos;t in
              your inbox within a few minutes.
            </span>
          </div>

          <div className={pay.card} style={{ marginTop: 20 }}>
            <h3 className={pay.cardTitle}>What happens next</h3>
            <ol
              style={{
                margin: 0,
                paddingLeft: 18,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 14,
                color: "var(--text-dim)",
                lineHeight: 1.55,
              }}
            >
              <li>Email lands with the one tap sign in link.</li>
              <li>
                Pick a time for the 30 minute Discord call from Tim&apos;s
                calendar.
              </li>
              <li>
                Tim sends the Discord server invite to the player before the
                call.
              </li>
              <li>
                Slides and voiceover drop into the player view after the
                call so they can review.
              </li>
            </ol>
          </div>

          <p
            style={{
              textAlign: "center",
              marginTop: 20,
              fontSize: 13,
              color: "var(--text-faint)",
            }}
          >
            Email not showing up? Check spam, or write{" "}
            <a href="mailto:tim@xplkeyed.com" style={{ color: "var(--lime)" }}>
              tim@xplkeyed.com
            </a>
            .
          </p>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <a href="/" className={`${shell.btn} ${shell.btnPrimary}`}>
              Done
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
