// Shared "Coming soon" page used by every /portal/* sidebar destination
// except /portal itself. The destination exists as a real route so the
// spatial structure of the sidebar is correct: clicking Billing always
// lands on /portal/billing. The page itself just explains what'll live
// there once it's built.
//
// Dash free copy per Hard rule #8 in any user facing text passed in.

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

      <Link href={"/portal" as never} className={styles.backLink}>
        Back to overview
      </Link>
    </div>
  );
}
