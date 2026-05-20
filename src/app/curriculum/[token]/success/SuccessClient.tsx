"use client";

// Celebratory "you're booked" surface that pops up after Stripe redirects
// back. CSS-only confetti — 40 colored squares, randomized horizontal
// position + delay + duration via inline styles, falling top-to-bottom
// with rotation. No library dep. prefers-reduced-motion mounts the
// confetti as static dots that don't move.

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./success.module.css";

type Particle = {
  left: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  rotation: number;
};

const COLORS = ["#C7FF3D", "#4C51F7", "#F5A623", "#ffffff"];

function makeParticles(count: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 2.2 + Math.random() * 2.4,
      size: 6 + Math.random() * 8,
      color: COLORS[i % COLORS.length],
      rotation: Math.random() * 360,
    });
  }
  return out;
}

export default function SuccessClient({
  kidFirstName,
  immediateDelivery,
}: {
  kidFirstName: string | null;
  immediateDelivery: boolean;
}) {
  // Particles are randomized via Math.random(), which produces different
  // values on the server and the client — running it during SSR would
  // throw a hydration mismatch when React reconciles. Generate them in
  // a useEffect so they only render after the component mounts in the
  // browser. The card below renders immediately on SSR; the confetti
  // pops in within a frame.
  const [particles, setParticles] = useState<Particle[]>([]);
  useEffect(() => {
    setParticles(makeParticles(48));
  }, []);

  const kid = kidFirstName ?? "Your child";

  return (
    <div className={styles.shell}>
      <div className={styles.confetti} aria-hidden>
        {particles.map((p, i) => (
          <span
            key={i}
            className={styles.particle}
            style={{
              left: `${p.left}%`,
              top: `-${p.size}px`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              transform: `rotate(${p.rotation}deg)`,
            }}
          />
        ))}
      </div>

      <div className={styles.card}>
        <div className={styles.brandMark}>XPLKeyed.com</div>
        <div className={styles.eyebrow}>Congratulations</div>
        <h1 className={styles.headline}>You&apos;re booked.</h1>
        <p className={styles.bodyText}>
          {immediateDelivery
            ? `${kid} receives his first PDF lesson today and new lessons will arrive every Sunday after that.`
            : `${kid}'s first PDF lesson drops this Sunday and new lessons will arrive every Sunday after that.`}
        </p>
        <p className={styles.bodyText}>
          Message me anytime from your parent dashboard if you have
          questions or need help.
        </p>
        <Link href={"/portal?welcome=1" as never} className={styles.primaryBtn}>
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
