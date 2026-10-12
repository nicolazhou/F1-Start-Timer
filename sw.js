/* Offline-first app shell; all paths are relative to this service worker's scope.
 * Safe on GitHub Pages project subpaths as well as domain-root deployments. */
"use strict";
const CACHE_PREFIX = `f1-start-timer-${new URL(self.registration.scope).pathname.replace(/[^a-z0-9]/gi, "_")}-v`;
const CACHE_NAME = `${CACHE_PREFIX}1.7.3`;
const SHELL_FILES = [
  "./", "./index.html", "./manifest.webmanifest",
  "./src/style.css", "./src/game.js", "./src/options.js",
  "./src/i18n.js", "./src/history.js", "./src/backup.js", "./src/training.js",
  "./src/training-ui.js", "./src/result-card.js", "./src/pwa.js", "./src/main.js",
  "./public/favicon.ico", "./public/favicon-16x16.png",
  "./public/favicon-32x32.png", "./public/apple-touch-icon.png",
  "./public/icon-192.png", "./public/icon-512.png",
  "./public/icons/gear.svg", "./public/icons/stopwatch.svg",
  "./public/icons/chevron-down.svg",
];
const scopedURL = (path) => new URL(path, self.registration.scope).href;
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES.map(scopedURL))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const shellURL = new Set(SHELL_FILES.map(scopedURL));
  if (request.mode === "navigate") {
    // Fresh HTML online; cached shell if no connection. Never cache unknown pages.
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(scopedURL("./index.html"))) || Response.error();
    }));
  } else if (shellURL.has(url.href)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
