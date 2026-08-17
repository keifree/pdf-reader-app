/**
 * Antigravity PDF Studio - Service Worker for PWA
 * Caches core app assets for offline launch & satisfies PWA installation criteria.
 */

const CACHE_NAME = 'pdf-studio-v404';

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
        './js/drive-manager.js'
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
  // Pass Google Drive API / external requests directly to network
  if (event.request.url.includes('googleapis.com') || event.request.url.includes('google.com') || event.request.url.includes('jsdelivr.net')) {
    return;
  }

  // Network-First strategy for local app code files
  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
      }
      return networkResponse;
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
