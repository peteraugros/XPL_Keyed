"use client";

// Coach-side sidebar shell. Same mechanic as PortalShell and PlayShell:
// persistent sidebar at ≥768px, hamburger drawer below. Coach name
// shown in the footer plus a sign-out. Mode toggle (Focused / Command)
// lives on the Home page itself since it only affects Home content;
// other pages are mode-agnostic.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "./admin-shell.module.css";
import { getSoundEnabled, setSoundEnabled, SOUND_PREF_EVENT } from "@/lib/sound/prefs";
import { playChime } from "@/lib/sound/chime";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type NavItem = { href: string; label: string; soon?: boolean };

const NAV: NavItem[] = [
  { href: "/admin", label: "Home" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/inbox", label: "Inbox" },
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
  const [showIosBanner, setShowIosBanner] = useState(false);
  const subscribed = useRef(false);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  // Subscribe to web push on first mount. Silently skips if:
  //   - browser doesn't support push or service worker
  //   - permission was explicitly denied
  //   - already subscribed this session (ref guard)
  //
  // iOS Safari requires the PWA to be installed (Add to Home Screen, display:
  // standalone) for push to work. If we're on iOS Safari in the browser (not
  // standalone), show a gentle install nudge instead.
  useEffect(() => {
    if (subscribed.current) return;
    if (typeof window === "undefined") return;

    // Detect iOS Safari running outside standalone mode.
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
    const isStandalone =
      "standalone" in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isIos && !isStandalone) {
      setShowIosBanner(true);
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "denied") return;
    if (!VAPID_PUBLIC_KEY) return;

    subscribed.current = true;

    (async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;

        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();

        let sub = existing;
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as BufferSource,
          });
        }

        const json = sub.toJSON() as {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        };

        await fetch("/api/admin/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            userAgent: navigator.userAgent,
          }),
        });
      } catch (err) {
        console.warn("[push] subscribe failed", err);
      }
    })();
  }, []);

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
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
        {showIosBanner ? (
          <div className={styles.iosBanner}>
            <span>Add to Home Screen for call reminders</span>
            <button
              type="button"
              className={styles.iosBannerDismiss}
              onClick={() => setShowIosBanner(false)}
            >
              Dismiss
            </button>
          </div>
        ) : null}
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
