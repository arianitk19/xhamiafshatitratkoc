/* =============================================================
 * service-worker.js — Offline-first caching for Xhamia Ratkoc PWA
 *
 * Strategy:
 *   - Cache-first for static assets (HTML, CSS, JS, icons, gallery)
 *   - Network-first for prayer time API (Aladhan) with cache fallback
 *   - Stale-while-revalidate for fonts
 *   - Background Sync handler to refresh prayer cache when reconnected
 * ============================================================= */

const APP_VERSION = '1.0.0';
const STATIC_CACHE = `xr-static-${APP_VERSION}`;
const RUNTIME_CACHE = `xr-runtime-${APP_VERSION}`;
const PRAYER_CACHE = `xr-prayer-${APP_VERSION}`;
const FONT_CACHE = `xr-fonts-${APP_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/storage.js',
  './js/prayer-engine.js',
  './js/notifications.js',
  './js/ui-controller.js',
  './js/sw-register.js',
  './assets/icons/icon-72.png',
  './assets/icons/icon-96.png',
  './assets/icons/icon-128.png',
  './assets/icons/icon-144.png',
  './assets/icons/icon-152.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-384.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-16.png',
  './assets/icons/favicon-32.png',
  './assets/gallery/gallery-1.jpg',
  './assets/gallery/gallery-2.jpg',
  './assets/gallery/gallery-3.jpg',
  './assets/gallery/gallery-4.jpg',
  './assets/gallery/gallery-5.jpg',
  './assets/gallery/gallery-6.jpg',
  './assets/gallery/gallery-1-thumb.jpg',
  './assets/gallery/gallery-2-thumb.jpg',
  './assets/gallery/gallery-3-thumb.jpg',
  './assets/gallery/gallery-4-thumb.jpg',
  './assets/gallery/gallery-5-thumb.jpg',
  './assets/gallery/gallery-6-thumb.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    try {
      await cache.addAll(PRECACHE);
    } catch (e) {
      // best-effort: add individually so a single 404 doesn't break install
      for (const url of PRECACHE) {
        try { await cache.add(url); } catch (_) {}
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (![STATIC_CACHE, RUNTIME_CACHE, PRAYER_CACHE, FONT_CACHE].includes(k)) {
        return caches.delete(k);
      }
    }));
    await self.clients.claim();
  })());
});

function isAladhan(url) { return /(?:^|\.)aladhan\.com\//.test(url.hostname) || url.hostname === 'api.aladhan.com'; }
function isFontResource(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}
function isTailwindCDN(url) { return url.hostname === 'cdn.tailwindcss.com'; }
function isSameOrigin(url) { return url.origin === self.location.origin; }
function isNavigation(req) { return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html')); }

async function networkFirst(event, cacheName, timeoutMs = 5000) {
  const cache = await caches.open(cacheName);
  try {
    const fetchPromise = fetch(event.request);
    const timeout = new Promise((resolve) => setTimeout(() => resolve('__timeout__'), timeoutMs));
    const res = await Promise.race([fetchPromise, timeout]);
    if (res === '__timeout__') throw new Error('timeout');
    if (res && res.ok) cache.put(event.request, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached) {
    // refresh in background
    event.waitUntil((async () => {
      try {
        const fresh = await fetch(event.request);
        if (fresh && fresh.ok) cache.put(event.request, fresh.clone());
      } catch (_) {}
    })());
    return cached;
  }
  try {
    const res = await fetch(event.request);
    if (res && res.ok) cache.put(event.request, res.clone());
    return res;
  } catch (e) {
    // For navigation fallbacks
    if (isNavigation(event.request)) {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then((res) => {
    if (res && res.ok) cache.put(event.request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Aladhan API → network-first with cache fallback
  if (isAladhan(url)) {
    event.respondWith(networkFirst(event, PRAYER_CACHE, 6000));
    return;
  }

  // Google Fonts (css + woff2) → stale-while-revalidate
  if (isFontResource(url)) {
    event.respondWith(staleWhileRevalidate(event, FONT_CACHE));
    return;
  }

  // Tailwind CDN → stale-while-revalidate so first paint works, then upgrade
  if (isTailwindCDN(url)) {
    event.respondWith(staleWhileRevalidate(event, RUNTIME_CACHE));
    return;
  }

  // Same-origin → cache-first
  if (isSameOrigin(url)) {
    event.respondWith(cacheFirst(event, STATIC_CACHE));
    return;
  }

  // Cross-origin GET → stale-while-revalidate as a safe default
  event.respondWith(staleWhileRevalidate(event, RUNTIME_CACHE));
});

/* ---------- Background Sync ---------- */
self.addEventListener('sync', (event) => {
  if (event.tag === 'xr-prayer-refresh') {
    event.waitUntil(refreshPrayerCache());
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'xr-prayer-periodic') {
    event.waitUntil(refreshPrayerCache());
  }
});

async function refreshPrayerCache() {
  // The SW cannot run app modules directly, but we can fetch today's URL using
  // default parameters matching the app. The latest prefs may differ; in that
  // case the next foreground refresh will reconcile.
  try {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yy = today.getFullYear();
    const url = `https://api.aladhan.com/v1/timings/${dd}-${mm}-${yy}?latitude=42.3833&longitude=20.6500&method=13&school=1&timezonestring=Europe/Belgrade&iso8601=false`;
    const res = await fetch(url);
    if (res && res.ok) {
      const cache = await caches.open(PRAYER_CACHE);
      await cache.put(url, res.clone());
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: 'CACHE_UPDATED', source: 'periodic' }));
    }
  } catch (e) {}
}

/* ---------- Notification clicks ---------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const data = event.notification.data || {};
    const target = (data.prayer ? '?tab=namazi' : '');
    for (const client of allClients) {
      if ('focus' in client) {
        client.postMessage({ type: 'PRAYER_FIRED', data });
        try { client.navigate(`./index.html${target}`); } catch (_) {}
        return client.focus();
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(`./index.html${target}`);
    }
  })());
});

/* ---------- Message handler (allows app to ask SW to skip waiting) ---------- */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});
