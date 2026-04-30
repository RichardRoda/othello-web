const CACHE = 'othello-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './worker.js',
  './othello_web.js',
  './othello_web_bg.wasm',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached ?? fetch(event.request))
  );
});
