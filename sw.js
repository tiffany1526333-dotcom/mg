/* Combobox service worker.
   1782573264107 is replaced by build.js at build time with a unique stamp,
   so every deploy ships a byte-different sw.js → the browser detects an update
   → the app shows the 「发现新版本」 banner.

   Caching strategy:
   • navigation (HTML)      → network-first, fall back to cache (offline support)
   • /api/* (dynamic data)  → never cached, always network
   • same-origin static     → stale-while-revalidate (icons, manifest)
*/
'use strict';

const VERSION    = '1782573264107';
const CACHE_NAME = 'combobox-' + VERSION;
const APP_SHELL  = ['./', 'index.html', 'manifest.webmanifest',
                    'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {}))
  );
  // Do NOT auto-skipWaiting — wait for the user to confirm via the update banner.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page tells us to take over once the user taps 「立即更新」.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API or image-proxy traffic (dynamic / cross-origin).
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // Navigations → network-first so the latest HTML wins when online.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Static same-origin assets → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
