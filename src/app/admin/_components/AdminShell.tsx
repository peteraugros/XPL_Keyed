"use client";

// Coach-side sidebar shell. Same mechanic as PortalShell and PlayShell:
// persistent sidebar at ≥768px, hamburger drawer below. Coach name
// shown in the footer plus a sign-out. Mode toggle (Focused / Command)
// lives on the Home page itself since it only affects Home content;
// other pages are mode-agnostic.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "./admin-shell.module.css";
import { getSoundEnabled, setSoundEnabled, SOUND_PREF_EVENT } from "@/lib/sound/prefs";
import { playChime } from "@/lib/sound/chime";

type NavItem = { href: string; label: string; soon?: boolean };

const NAV: NavItem[] = [
  { href: "/admin", label: "Home" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/waitlist", label: "Waitlist" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/lessons", label: "Lessons" },
  { href: "/admin/money", label: "Money" },
];

export default function AdminShell({
  coachName,
  isDad = false,
  children,
}: {
  coachName: string;
  isDad?: boolean;
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

  // Active matching: exact match, except for nested routes (/admin/lessons/new
  // should still highlight Lessons). startsWith is good enough; root /admin
  // gets exact-match treatment so it doesn't claim every sub-route.
  function isActive(href: string): boolean {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className={styles.shell}>
      <aside
        className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ""}`}
        aria-label="Coach navigation"
      >
        <div className={styles.brand}>
          <div className={styles.brandMark}>XPL</div>
          <div className={styles.brandSub}>Coach admin</div>
        </div>
        <nav className={styles.nav}>
          <ul className={styles.navList}>
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href as never}
                    className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                    onClick={closeDrawer}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className={styles.navLabel}>{item.label}</span>
                    {item.soon ? <span className={styles.navSoon}>Soon</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.sidebarFooterName}>{coachName}</div>
          {isDad ? (
            <Link
              href={"/dad" as never}
              className={styles.backToDadBtn}
              onClick={closeDrawer}
            >
              ← Back to Dad view
            </Link>
          ) : null}
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
          <div className={styles.topBarTitle}>Coach admin</div>
          <SoundToggle />
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}

// Mute toggle for the task-completion chime. Default on (unless OS
// reduced-motion). Persisted to localStorage. Tapping the button also
// plays the chime when un-muting so Tim hears what he just enabled.
function SoundToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  // null on first render so we don't render the WRONG icon during
  // hydration; localStorage isn't available until after mount.
  useEffect(() => {
    setEnabled(getSoundEnabled());
    function onExternal() {
      setEnabled(getSoundEnabled());
    }
    window.addEventListener(SOUND_PREF_EVENT, onExternal);
    return () => window.removeEventListener(SOUND_PREF_EVENT, onExternal);
  }, []);
  function toggle() {
    const next = !(enabled ?? true);
    setSoundEnabled(next);
    setEnabled(next);
    window.dispatchEvent(new CustomEvent(SOUND_PREF_EVENT));
    if (next) playChime();
  }
  if (enabled === null) {
    return <span className={styles.soundToggle} aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className={styles.soundToggle}
      aria-label={enabled ? "Mute task completion sounds" : "Unmute task completion sounds"}
      title={enabled ? "Sound on. Click to mute." : "Sound off. Click to unmute."}
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
