// Service worker for the Shift & Incident Log PWA.
// Strategy:
//   • App shell (HTML/CSS/JS/icon) is precached so the app loads offline.
//   • CDN libraries are runtime-cached (cache-first, refreshed in the background).
//   • Supabase requests are never cached — writes made while offline are queued
//     in IndexedDB by the app and synced when the connection returns.

const CACHE = "shiftlog-v16";

// Paths are relative so the SW works both at the domain root (local preview)
// and under a project subpath (GitHub Pages).
const CORE = [
  "./",
  "./index.html",
  "./style.css?v=16",
  "./script.js?v=16",
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

// Network-first: always try the network, fall back to cache when offline.
// Used for same-origin JS/CSS so laptops never get stuck on a stale bundle.
function networkFirst(request) {
  return caches.open(CACHE).then(async (cache) => {
    try {
      const res = await fetch(request);
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      return cache.match(request);
    }
  });
}

// Stale-while-revalidate: serve from cache instantly, refresh in background.
// Used only for large CDN libraries that rarely change (Chart.js, Supabase JS).
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
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Supabase API + storage: always network, never cache.
  if (url.hostname.endsWith("supabase.co")) return;

  // Page navigations: network-first, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  // CDN libraries: stale-while-revalidate (large, rarely change).
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Same-origin JS/CSS: network-first so updates are always picked up immediately.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});
