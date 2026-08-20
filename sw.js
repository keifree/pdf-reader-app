/**
 * Antigravity PDF Studio - Service Worker for PWA
 * Caches core app assets for offline launch & satisfies PWA installation criteria.
 */

const CACHE_NAME = 'pdf-studio-v412';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        './',
        './index.html',
        './style.css',
        './js/app.js',
        './js/pdf-viewer.js',
        './js/annotation-manager.js',
        './js/pdf-exporter.js',
        './js/google-drive.js'
      ]);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Purging old PWA cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass Google Drive API / CDN requests directly to network
  if (
    event.request.url.includes('googleapis.com') ||
    event.request.url.includes('google.com') ||
    event.request.url.includes('jsdelivr.net') ||
    event.request.url.includes('cdnjs.cloudflare.com') ||
    event.request.url.includes('unpkg.com')
  ) {
    return;
  }

  // Network-First with cache-busting for HTML navigation (prevents stale index.html in PWA)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((res) => res || caches.match('./index.html') || caches.match('./'));
        })
    );
    return;
  }

  // Network-First strategy for local app code files
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
