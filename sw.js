/* ============================================
   MEDCARE REMINDER - SERVICE WORKER
   Fixed for GitHub Pages subfolder hosting
============================================ */

const CACHE_NAME = 'medcare-v2.0.0';
const BASE = '/medcare-app';
const ASSETS_TO_CACHE = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/css/style.css',
  BASE + '/js/app.js',
  BASE + '/manifest.json',
  BASE + '/icons/icon-72.png',
  BASE + '/icons/icon-96.png',
  BASE + '/icons/icon-128.png',
  BASE + '/icons/icon-144.png',
  BASE + '/icons/icon-152.png',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-384.png',
  BASE + '/icons/icon-512.png'
];

// Install - cache all assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE.filter(url => !url.startsWith('http')));
    }).then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension requests
  if (event.request.url.startsWith('chrome-extension://')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((response) => {
        // Don't cache bad responses or non-basic requests
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }

        // Cache successful responses
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Return offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match(BASE + '/index.html');
        }
      });
    })
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'Time to take your medicine!',
    icon: BASE + '/icons/icon-192.png',
    badge: BASE + '/icons/icon-72.png',
    vibrate: [300, 100, 300],
    data: data,
    actions: [
      { action: 'taken', title: '✅ Taken' },
      { action: 'snooze', title: '⏰ Snooze' }
    ],
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '💊 MedCare Reminder', options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'taken') {
    // Could post message to client to mark as taken
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        for (const client of clientList) {
          client.postMessage({ action: 'markTaken', data: event.notification.data });
        }
      })
    );
  }

  event.waitUntil(
    clients.openWindow('/')
  );
});

// ============================================
// BACKGROUND ALARM CHECKER
// Runs every 60s inside the Service Worker.
// Posts a message to the active page so the
// page's Reminders._poll() can fire the alarm.
// ============================================
let bgCheckInterval = null;

self.addEventListener('activate', () => {
  if (bgCheckInterval) clearInterval(bgCheckInterval);
  bgCheckInterval = setInterval(async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: 'MC_BG_TICK' }));
  }, 60_000);
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'MC_KEEPALIVE') {
    // Page is alive — SW responds to confirm it's running
    event.source.postMessage({ type: 'MC_SW_ALIVE' });
  }
});
