"use client";

// Kid-side sidebar shell. Same mechanic as the parent's PortalShell but
// kid-tone: bigger labels, rarity accents on nav items, friendlier
// section names (HQ / Squad / Library / Loadout). Hamburger drawer
// below 768px. Sign out in the sidebar footer.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import styles from "./play-shell.module.css";

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: "/play", label: "HQ" },
  { href: "/play/library", label: "Lesson library" },
  { href: "/play/squad", label: "Chat" },
  { href: "/play/loadout", label: "Loadout" },
];

export default function PlayShell({
  playerFirstName,
  children,
}: {
  playerFirstName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  async function onSignOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      /* fall through */
    }
    (router.replace as (u: string) => void)("/login");
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      <aside
        className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ""}`}
        aria-label="Player navigation"
      >
        <div className={styles.brand}>
          <div className={styles.brandMark}>XPL</div>
          <div className={styles.brandSub}>Player view</div>
        </div>
        <nav className={styles.nav}>
          <ul className={styles.navList}>
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href as never}
                    className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                    onClick={closeDrawer}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className={styles.navLabel}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className={styles.sidebarFooter}>
          <button
            type="button"
            onClick={onSignOut}
            disabled={busy}
            className={styles.signOutBtn}
          >
            {busy ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </aside>

      {drawerOpen ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close menu"
          onClick={closeDrawer}
        />
      ) : null}

      <div className={styles.main}>
        <header className={styles.topBar}>
          <button
            type="button"
            className={styles.hamburger}
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            aria-expanded={drawerOpen}
          >
            <span />
            <span />
            <span />
          </button>
          <div className={styles.topBarTitle}>
            What up, {playerFirstName}
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
