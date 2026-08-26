const CACHE_VERSION = 'proinspect-bm-static-v1';
const STATIC_ASSETS = [
  '/static/style.css',
  '/static/app.js',
  '/static/pwa.js',
  '/static/operations-forms.js',
  '/static/inspections.js',
  '/static/monthly-reports.js',
  '/static/resident-operations.js',
  '/static/contractor-portal.js',
  '/static/proinspect-icon.svg',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated HTML, API responses, evidence or documents.
  // Draft data remains in localStorage under explicit form controls instead.
  const cacheable = url.pathname.startsWith('/static/') || url.pathname === '/manifest.webmanifest';
  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});
