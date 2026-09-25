// frontend/sw.js
// Service Worker pour Devis Express Pro (PWA)

const CACHE_VERSION = 'devis-pro-v1.0.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Ressources à mettre en cache dès l'installation
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/i18n.js'
];

// ============================================================
// INSTALLATION
// ============================================================
self.addEventListener('install', (event) => {
    console.log('[SW] Installation...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// ============================================================
// ACTIVATION
// ============================================================
self.addEventListener('activate', (event) => {
    console.log('[SW] Activation...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// ============================================================
// FETCH — stratégie de cache
// ============================================================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Ne pas intercepter les API (toujours réseau)
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Ne pas intercepter les WebSocket, HMR, etc.
    if (request.method !== 'GET') return;

    // Ressources statiques → cache-first
    if (
        request.destination === 'style' ||
        request.destination === 'script' ||
        request.destination === 'font' ||
        request.destination === 'image' ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.json')
    ) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(response => {
                    if (!response || response.status !== 200) return response;
                    const clone = response.clone();
                    caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
                    return response;
                });
            })
        );
        return;
    }

    // HTML → network-first (pour avoir les dernières mises à jour)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    // Autres → network-first avec fallback cache
    event.respondWith(
        fetch(request)
            .then(response => {
                if (!response || response.status !== 200) return response;
                const clone = response.clone();
                caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
                return response;
            })
            .catch(() => caches.match(request))
    );
});

// ============================================================
// NOTIFICATIONS PUSH
// ============================================================
self.addEventListener('push', (event) => {
    console.log('[SW] Push reçu');
    
    let data = {
        title: 'Devis Express Pro',
        body: 'Nouvelle notification',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        url: '/',
        tag: 'default'
    };

    if (event.data) {
        try {
            const payload = event.data.json();
            data = { ...data, ...payload };
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: data.icon,
        badge: data.badge,
        tag: data.tag,
        data: { url: data.url },
        vibrate: [200, 100, 200],
        requireInteraction: false
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// ============================================================
// CLIC SUR NOTIFICATION
// ============================================================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // Si une fenêtre est déjà ouverte, focus
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            // Sinon, ouvrir une nouvelle fenêtre
            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});