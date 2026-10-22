// DebtFlow Pro - Pure Turbo Auto-Dialer Service Worker
const CACHE_NAME = 'debtflow-turbo-v116';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(() => {});
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            );
        })
    );
    self.clients.claim();
});

// Stale-While-Revalidate: Instant Local Load + Background Auto-Update
self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    if (e.request.url.includes('/api/') || e.request.url.includes('.apk')) return;

    e.respondWith(
        caches.match(e.request).then((cached) => {
            const networkFetch = fetch(e.request).then((res) => {
                if (res && (res.status === 200 || res.type === 'opaque')) {
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
                }
                return res;
            }).catch(() => cached);

            return cached || networkFetch;
        })
    );
});
