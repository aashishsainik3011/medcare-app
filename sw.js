/* ============================================
   MEDCARE REMINDER - SERVICE WORKER
   Enables offline capability & caching
============================================ */

const CACHE_NAME = 'medcare-v1.0.0';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-128.png',
  '/icons/icon-144.png',
  '/icons/icon-152.png',
  '/icons/icon-192.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Lora:wght@400;600;700&display=swap'
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
          return caches.match('/index.html');
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
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
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
