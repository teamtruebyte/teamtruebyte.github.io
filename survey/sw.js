/* Service worker — makes the app open and run with no signal.
 *
 * Only same-origin STATIC assets are cached. Supabase API and storage calls are
 * never intercepted: stale survey data would be worse than an honest failure,
 * and the app already queues its own writes in IndexedDB.
 *
 * Bump CACHE when you deploy so phones pick the new build up immediately —
 * otherwise an old shell can linger (the same cache trap the Flutter portal hit).
 */
const CACHE = 'surveyor-pwa-v5';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './vendor/supabase.js',
  './js/app.js',
  './js/api.js',
  './js/store.js',
  './js/capture.js',
  './js/schema.js',
  './js/config.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Individually so one missing file can't fail the whole install.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase etc. -> network

  // Navigations: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then((r) => r || Response.error())),
    );
    return;
  }

  // Static assets: serve from cache, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
