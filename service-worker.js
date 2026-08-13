const CACHE_NAME = 'iape-gestao-estudantil-v8';
const APP_SHELL = [
  './login.html',
  './index.html',
  './students.html',
  './student.html',
  './sponsor.html',
  './editor.html',
  './escolhersetores.html',
  './chamada.html',
  './dashboard.html',
  './assets/app.css',
  './assets/config.js',
  './assets/config2.js',
  './assets/api.js',
  './assets/attendance-api.js',
  './assets/dashboard.js',
  './assets/editor.js',
  './assets/students.js',
  './assets/ui.js',
  './assets/attendance.css',
  './assets/loading.js',
  './icons/favicon.svg',
  './icons/favicon.ico',
  './icons/apple-touch-icon.png',
  './icons/android-chrome-192x192.png',
  './icons/android-chrome-512x512.png',
  './icons/site.webmanifest'
];

const NETWORK_FIRST_PATHS = new Set([
  'assets/config.js',
  'assets/config2.js',
  'assets/api.js',
  'assets/attendance-api.js'
]);

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(APP_SHELL);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE_NAME; })
      .map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});

function isCacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

function relativePath(request) {
  const scopePath = new URL(self.registration.scope).pathname;
  const pathname = new URL(request.url).pathname;
  return pathname.indexOf(scopePath) === 0 ? pathname.slice(scopePath.length) : pathname.replace(/^\//, '');
}

async function fetchAndCache(request, options) {
  const response = await fetch(request, options || {});
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, options, fallback) {
  try {
    const response = await fetchAndCache(request, options);
    if (response.ok) return response;
    return (await caches.match(request)) || (fallback ? await caches.match(fallback) : null) || response;
  } catch (error) {
    return (await caches.match(request)) || (fallback ? await caches.match(fallback) : null) || Response.error();
  }
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (!isCacheable(request)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, { cache: 'no-store' }, './login.html'));
    return;
  }

  if (NETWORK_FIRST_PATHS.has(relativePath(request))) {
    event.respondWith(networkFirst(request, { cache: 'no-store' }));
    return;
  }

  const backgroundUpdate = fetchAndCache(request).catch(function () { return null; });
  event.waitUntil(backgroundUpdate);
  event.respondWith(caches.match(request).then(function (cached) {
    return cached || backgroundUpdate.then(function (response) { return response || Response.error(); });
  }));
});
