// Callboard's offline shell (PRD 5): the person and lead pages stay openable with no signal.
// /p/* pages are network-first with the last good copy as fallback; Next's hashed static files are cache-first.
// Check-in taps made offline are queued by the page itself (taps.tsx), not here.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => (caches.open('static').then((c) => c.put(e.request, r.clone())), r))));
  } else if (url.pathname.startsWith('/p/') && !url.pathname.includes('/act')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => (r.ok && caches.open('pages').then((c) => c.put(e.request, r.clone())), r))
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || new Response('Offline and no saved copy of this page yet. Open it once with signal.', { status: 503 }))),
    );
  }
});
