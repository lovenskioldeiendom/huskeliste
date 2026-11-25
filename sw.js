// Service worker: appen åpner raskt og fungerer med dårlig nett.
const CACHE = 'huskeliste-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const same = url.origin === location.origin, cdn = url.host === 'cdn.jsdelivr.net';
  if (!same && !cdn) return; // Supabase går rett på nett
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (cdn) { const hit = await cache.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) cache.put(e.request, r.clone()); return r; }
    try { const r = await fetch(e.request, { cache: 'no-cache' }); if (r.ok) cache.put(e.request, r.clone()); return r; }
    catch { return (await cache.match(e.request)) || (await cache.match('index.html')); }
  })());
});
