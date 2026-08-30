/* Back It (Onchain) — service worker (FE-31).
 *
 * Offline-first for the feed. Two caches:
 *   - shell: static assets + app shell (cache-first)
 *   - feed: GET /feed and /calls responses (network-first, stale while
 *     revalidating) so the feed renders from the last good snapshot when the
 *     network is down and only refills when a request actually succeeds.
 */
const SHELL_CACHE = 'backit-shell-v1';
const FEED_CACHE = 'backit-feed-v1';

const SHELL_URLS = ['/', '/manifest.json'];

const FEED_API_PATTERN = /\/feed|\/calls/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== FEED_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, copy);
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(FEED_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ items: [], nextCursor: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Feed API lives on a different origin in dev; cache those endpoints only.
  if (FEED_API_PATTERN.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Same-origin static assets and app shell.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});