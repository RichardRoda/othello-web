const CACHE = '__CACHE_KEY__';
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
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url))))
  );
});

const SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy':   'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Access-Control-Allow-Origin':  '*',
  'Content-Security-Policy':      "script-src 'self' 'wasm-unsafe-eval'",
};

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached ?? fetch(event.request))
      .then(response => {
        const headers = new Headers(response.headers);
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
  );
});
