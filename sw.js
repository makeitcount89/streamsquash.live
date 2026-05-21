const CACHE = 'squashlive-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/watch.html',
  '/auth.html',
  '/broadcast.html',
  '/manifest.json'
];

// Install — cache shell pages
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first for API/streams, cache first for shell
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API calls, WebRTC, or external resources
  if (url.pathname.startsWith('/api/') ||
      url.hostname !== self.location.hostname ||
      e.request.method !== 'GET') {
    return; // fall through to network
  }

  // Cache-first for HTML/CSS/JS shell
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || network;
    })
  );
});
