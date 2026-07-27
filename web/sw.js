// Caches the app shell so the page opens with no signal. Notes captured
// offline are queued in localStorage by index.html and flushed on reconnect.
// Roam API calls are never cached — they must always hit the network.
// Bump this whenever a shipped fix must reach devices that already cached the
// old shell. `activate` deletes every cache whose name is not this one, so a new
// value evicts the stale index.html rather than waiting for a hard refresh.
const CACHE = 'voice-to-roam-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Where this worker is registered — "/" at a domain root, "/transcribe-whisper/"
 *  when the app is served under a path. Every path test below is relative to it,
 *  because a root-anchored test silently stops matching under a prefix. */
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never cache the vault API: a cached api/vault would serve one device's
  // state — or a stale "no passphrase set" — after the vault changed.
  if (url.pathname.startsWith(`${SCOPE}api/`)) return;
  // Nor the transcriber: it is a POST in practice, but never serve it from cache.
  if (url.pathname.startsWith(`${SCOPE}whisper`)) return;
  // Network-first so a redeploy is picked up, falling back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
