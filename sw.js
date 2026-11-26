/* Service worker: la app funciona sin conexión en la playa. */
const V = 'v2';
const SHELL = `shell-${V}`, RUNTIME = 'runtime', TILES = 'tiles';
const PRECACHE = ['./', 'index.html', 'app.css', 'app.js', 'data/zonas.json', 'data/ccaa.json', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'icons/icon-192.png', 'icons/icon-512.png', 'docs/circular-detectores-2021.pdf'];
const MAX_TILES = 2500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isTile = /ign\.es\/wmts|tile\.openstreetmap\.org/.test(url.href);
  if (isTile) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); trimTiles(); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin === location.origin) {
    // App: primero red para HTML/JS/datos (para recibir actualizaciones), caché si no hay conexión
    if (/\.(html|js|css|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/')) {
      e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(SHELL).then(c => c.put(req, cp)); return r; })
        .catch(() => caches.match(req, { ignoreSearch: true })));
      return;
    }
    // Mapas oficiales, iconos, PDF: caché primero
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const cp = r.clone(); caches.open(RUNTIME).then(c => c.put(req, cp)); return r; })));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const cp = r.clone(); caches.open(RUNTIME).then(c => c.put(req, cp)); return r; })));
  }
});
