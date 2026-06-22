// Service worker for the Shift & Incident Log PWA.
// Strategy:
//   • App shell (HTML/CSS/JS/icon) is precached so the app loads offline.
//   • CDN libraries are runtime-cached (cache-first, refreshed in the background).
//   • Supabase requests are never cached — writes made while offline are queued
//     in IndexedDB by the app and synced when the connection returns.

const CACHE = "shiftlog-v7";

// Paths are relative so the SW works both at the domain root (local preview)
// and under a project subpath (GitHub Pages).
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first with background refresh, used for both CDN and same-origin assets.
function staleWhileRevalidate(request) {
  return caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request)
      .then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; })
      .catch(() => cached);
    return cached || network;
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;            // never touch inserts/updates

  const url = new URL(request.url);

  // Supabase API + storage: always go to the network, never cache.
  if (url.hostname.endsWith("supabase.co")) return;

  // Page navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  // CDN libraries (Supabase JS, Chart.js).
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Same-origin static assets.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
