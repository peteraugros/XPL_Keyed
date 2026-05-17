"use client";

import { useEffect } from "react";

// Attaches all the interactive behavior the static marketing markup expects:
//   1. Hamburger toggle (body.menu-open class, escape key, backdrop click, link-tap close)
//   2. Scroll-reveal IntersectionObserver for `.reveal` elements
//   3. Count-up timer since C2S2 launch (2020-02-20), also updates `.js-years-since-c2s2` spans
//
// Renders nothing — pure side-effects so the static markup in page.tsx stays a Server Component.
export default function MarketingClient() {
  useEffect(() => {
    // -------- Hamburger --------
    const hamburger = document.getElementById("hamburger");
    const menu = document.getElementById("mobile-menu");

    const openMenu = () => {
      document.body.classList.add("menu-open");
      hamburger?.setAttribute("aria-expanded", "true");
    };
    const closeMenu = () => {
      document.body.classList.remove("menu-open");
      hamburger?.setAttribute("aria-expanded", "false");
    };
    const toggleMenu = () => {
      if (document.body.classList.contains("menu-open")) closeMenu();
      else openMenu();
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.body.classList.contains("menu-open")) closeMenu();
    };
    const onMenuClick = (e: MouseEvent) => {
      if (e.target === menu) closeMenu();
    };

    hamburger?.addEventListener("click", toggleMenu);
    const closers = menu?.querySelectorAll<HTMLElement>("[data-close]") ?? [];
    closers.forEach((a) => a.addEventListener("click", closeMenu));
    document.addEventListener("keydown", onKeydown);
    menu?.addEventListener("click", onMenuClick);

    // -------- Scroll reveal --------
    const reveals = document.querySelectorAll<HTMLElement>(".reveal");
    let observer: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
      );
      reveals.forEach((el) => observer!.observe(el));
    } else {
      reveals.forEach((el) => el.classList.add("is-visible"));
    }

    // -------- Count-up timer since Feb 20, 2020 (Chapter 2 Season 2 launch) --------
    const startDate = new Date("2020-02-20T00:00:00");
    const els = {
      years: document.getElementById("t-years"),
      days: document.getElementById("t-days"),
      hours: document.getElementById("t-hours"),
      minutes: document.getElementById("t-minutes"),
      seconds: document.getElementById("t-seconds"),
    };
    const yearSpans = document.querySelectorAll<HTMLElement>(".js-years-since-c2s2");
    const last: Record<keyof typeof els, number> = {
      years: -1,
      days: -1,
      hours: -1,
      minutes: -1,
      seconds: -1,
    };
    let tickTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (!els.seconds) return;
      const now = new Date();

      // Calendar-accurate years (handles leap years correctly)
      let years = now.getFullYear() - startDate.getFullYear();
      const anniversaryThisYear = new Date(startDate);
      anniversaryThisYear.setFullYear(now.getFullYear());
      if (now < anniversaryThisYear) years--;

      // Days since the most recent anniversary
      const anchor = new Date(startDate);
      anchor.setFullYear(startDate.getFullYear() + years);
      const msSinceAnchor = now.getTime() - anchor.getTime();
      const days = Math.floor(msSinceAnchor / 86_400_000);
      const hours = Math.floor((msSinceAnchor % 86_400_000) / 3_600_000);
      const minutes = Math.floor((msSinceAnchor % 3_600_000) / 60_000);
      const seconds = Math.floor((msSinceAnchor % 60_000) / 1000);

      const values = { years, days, hours, minutes, seconds };
      (Object.keys(values) as (keyof typeof values)[]).forEach((key) => {
        if (values[key] !== last[key]) {
          const el = els[key];
          if (el) el.textContent = String(values[key]);
          last[key] = values[key];
          if (key === "seconds" && els.seconds) {
            els.seconds.classList.add("tick");
            tickTimeoutId = setTimeout(() => {
              els.seconds?.classList.remove("tick");
            }, 180);
          }
          if (key === "years") {
            yearSpans.forEach((s) => {
              s.textContent = String(values.years);
            });
          }
        }
      });
    };

    if (els.seconds) {
      tick();
      intervalId = setInterval(tick, 1000);
    }

    return () => {
      hamburger?.removeEventListener("click", toggleMenu);
      closers.forEach((a) => a.removeEventListener("click", closeMenu));
      document.removeEventListener("keydown", onKeydown);
      menu?.removeEventListener("click", onMenuClick);
      observer?.disconnect();
      if (intervalId !== null) clearInterval(intervalId);
      if (tickTimeoutId !== null) clearTimeout(tickTimeoutId);
      document.body.classList.remove("menu-open");
    };
  }, []);

  return null;
}
