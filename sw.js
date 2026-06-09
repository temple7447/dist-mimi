const CACHE_NAME = 'mimis-kitchen-v1.2.3';
const API_HOST = 'mimiskitchenuk.space';

const APP_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.png',
];

// ─── Install: cache the app shell ───────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ─── Activate: remove stale caches ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // API requests → network-first, fallback to cache
  if (url.hostname === API_HOST) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Images & fonts → cache-first, then network
  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation (page loads) → network-first, fall back to cached app shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/') || caches.match('/index.html')
      )
    );
    return;
  }

  // JS / CSS bundles → stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});

// ─── Background Sync: retry failed cart/order requests ──────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'cart-sync') {
    event.waitUntil(replayFailedRequests());
  }
});

async function replayFailedRequests() {
  const cache = await caches.open('mimis-pending-requests');
  const keys = await cache.keys();
  await Promise.all(
    keys.map(async request => {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.delete(request);
      } catch {
        // Will retry on next sync
      }
    })
  );
}

// ─── Push Notifications (Web Push) ──────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || "Mimi's Kitchen", {
      body: data.body || 'You have a new update',
      icon: '/favicon.png',
      badge: '/favicon.png',
      data: data.data || {},
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const orderId = event.notification.data?.orderId;
  const url = orderId ? `/orders/ongoing` : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      const existing = windowClients.find(c => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(url);
      } else {
        clients.openWindow(url);
      }
    })
  );
});
