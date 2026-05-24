// PWA service worker — built by @serwist/next at build time.
// Read-only stale data offline mode per CLAUDE.md (no write queue).
//
// Strategy:
//   * App shell + static assets: precached, cache-first
//   * API GET responses: stale-while-revalidate (so offline reads return last
//     known data; new actions get a "You're offline" toast from the client)
//   * Cross-origin (fonts, images): cache-first with expiration
//
// Push notifications:
//   * push event: parse JSON payload, show a notification with title + body.
//   * notificationclick: focus the open admin tab or open a new one at the
//     deep-link URL in the notification data.

/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
};

self.addEventListener("push", (event: PushEvent) => {
  let payload: PushPayload = { title: "XPL Keyed" };
  try {
    if (event.data) payload = event.data.json() as PushPayload;
  } catch {
    if (event.data) payload = { title: event.data.text() };
  }

  const { title, body, url, tag } = payload;
  const options: NotificationOptions = {
    body: body ?? "",
    tag: tag ?? "xpl-keyed",
    icon: "/icons/icon.svg",
    badge: "/icons/icon.svg",
    data: { url: url ?? "/admin/calendar" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const target: string =
    (event.notification.data as { url?: string } | undefined)?.url ?? "/admin/calendar";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // If an admin tab is already open, focus it and navigate.
        for (const client of clients) {
          if (client.url.includes("/admin") && "focus" in client) {
            void (client as WindowClient).focus();
            void (client as WindowClient).navigate(target);
            return;
          }
        }
        // No admin tab open — open a new one.
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
      }),
  );
});
