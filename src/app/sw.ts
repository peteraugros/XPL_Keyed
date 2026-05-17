// PWA service worker — built by @serwist/next at build time.
// Read-only stale data offline mode per CLAUDE.md (no write queue).
//
// Strategy:
//   * App shell + static assets: precached, cache-first
//   * API GET responses: stale-while-revalidate (so offline reads return last
//     known data; new actions get a "You're offline" toast from the client)
//   * Cross-origin (fonts, images): cache-first with expiration

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
