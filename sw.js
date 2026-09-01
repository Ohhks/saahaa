/* SAAHAA service worker — network-first with an offline shell.
   Cache name carries BUILD_ID: a new build invalidates the old cache
   automatically, so a user can never end up with an old shell and new modules
   (failure mode #1 in docs/ARCHITECTURE.md). */
const BUILD = '20260901a';
const CACHE = 'saahaa-' + BUILD;
const SHELL = [
  './', './index.html', './manifest.json', './icon.svg',
  './src/ui/tokens.css', './src/ui/brand.css', './src/app.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
