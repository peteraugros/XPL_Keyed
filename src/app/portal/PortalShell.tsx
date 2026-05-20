"use client";

// Persistent sidebar (desktop) + hamburger drawer (mobile) that wraps every
// /portal/* route. Sign-out lives in the sidebar footer. Active link is
// highlighted off usePathname.
//
// Most sidebar items are "Coming soon" stubs for this pass. They still
// route to real pages that render a StubPage so the spatial structure
// is real (clicking Billing always lands on /portal/billing). The "Soon"
// chip is just visual: the page itself explains what'll live there.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./PortalClient";
import styles from "./portal-shell.module.css";

type NavItem = { href: string; label: string; soon?: boolean };

const NAV: NavItem[] = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/sessions", label: "Sessions", soon: true },
  { href: "/portal/progress", label: "Progress", soon: true },
  { href: "/portal/messages", label: "Chat" },
  { href: "/portal/billing", label: "Manage subscription" },
  { href: "/portal/settings", label: "Settings" },
];

export default function PortalShell({
  parentEmail,
  playerFirstName,
  children,
}: {
  parentEmail: string;
  playerFirstName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  return (
    <div className={styles.shell}>
      <aside
        className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ""}`}
        aria-label="Parent navigation"
      >
        <div className={styles.brand}>
          <div className={styles.brandMark}>XPLKeyed.com</div>
          <div className={styles.brandSub}>Parent dashboard</div>
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
                    {item.soon ? <span className={styles.navSoon}>Soon</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.sidebarFooterEmail} title={parentEmail}>
            {parentEmail}
          </div>
          <SignOutButton />
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
            {playerFirstName ? `${playerFirstName}'s coaching` : "Parent dashboard"}
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
