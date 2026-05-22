// /portal/coaches — Tim's coach profile.
//
// Static content. Single coach at MVP. No photo per Hard rule #1 — the
// rank credential and competitive history do the work. When the operator
// pair model lights up additional coaches, this page becomes a list
// keyed off the coaches table; for now it's just Tim.

import styles from "../_components/inner-page.module.css";

export const dynamic = "force-dynamic";

export default function CoachesPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Program</div>
        <h1 className={styles.title}>Coaches</h1>
        <p className={styles.intro}>
          Your kid is coached by Tim. Here is who he is and what he plays.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Coach profile</div>
        <h2 className={styles.cardTitle}>Tim, also known as XPL Keyed</h2>
        <div className={styles.metaRow}>
          <span className={`${styles.pill} ${styles.pillActive}`}>Unreal ranked</span>
          <span className={styles.pill}>14 years old</span>
          <span className={styles.pill}>Competing since 2020</span>
        </div>
        <p className={styles.cardBody}>
          Tim has been playing Fortnite competitively since Chapter 2 Season 2.
          Five plus years of ranked play and tournament practice means he sees
          the game from the inside, not as someone who watches streams and
          guesses. He coaches the way he learned: clip review, deliberate
          rep work, and small focused fixes per session.
        </p>
        <p className={styles.cardSubtle}>
          Tim is a 14 year old coaching 8 to 14 year olds. Same generation,
          same vocabulary, same frustrations as your kid. The trust model
          here is built around that: your kid talks to Tim, your kid sees
          your kid&apos;s peer, and you have full read access to every
          message and a seat in every Discord channel.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>How coaching runs</div>
        <h2 className={styles.cardTitle}>Async first, with a weekly live call</h2>
        <ul className={styles.bullets}>
          <li>Every Sunday Tim drops slides with voiceover for the week&apos;s topic. Your kid watches when they have time.</li>
          <li>Mid-week there is a 30 minute live call on Discord voice. Tim watches your kid play, gives real time feedback, and reviews a clip together.</li>
          <li>Curriculum is approved in 4 week chunks. You see the plan before each cycle starts.</li>
          <li>All Discord interaction happens in a private channel for your family. Tim never DMs your kid. You are invited as an observer.</li>
        </ul>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Safety promises</div>
        <h2 className={styles.cardTitle}>What we do, what we never do</h2>
        <ul className={styles.bullets}>
          <li>You can sit in on any call. Parents are invited to every kid&apos;s private Discord channel as an observer, so you can listen live whenever you want.</li>
          <li>Tim writes a short note after every call. It lands on your dashboard so you always see what was covered.</li>
          <li>No phone calls. No phone numbers collected. Coaching happens on Discord voice only.</li>
          <li>No DMs between Tim and your kid. All chat lives in the per family Discord channel where you have observer access.</li>
          <li>Your kid will never be photographed by us, and you will never see a photo of Tim either. Identity stays on rank and play, not faces.</li>
        </ul>
      </section>
    </div>
  );
}
