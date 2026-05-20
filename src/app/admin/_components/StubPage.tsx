// Shared "Coming soon" surface for /admin sidebar destinations that
// aren't built yet (Inbox / Money / Operations). Identical pattern to
// the parent dashboard's StubPage but scoped to coach surfaces.

import Link from "next/link";
import styles from "./stub-page.module.css";

export default function StubPage({
  eyebrow,
  title,
  intro,
  comingSoon,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  comingSoon: string[];
}) {
  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.intro}>{intro}</p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Coming soon</div>
        <ul className={styles.list}>
          {comingSoon.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <Link href={"/admin" as never} className={styles.backLink}>
        Back to home
      </Link>
    </div>
  );
}
