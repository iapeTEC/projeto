const CACHE_NAME = 'iape-gestao-estudantil-v4';
const APP_SHELL = [
  './login.html',
  './index.html',
  './students.html',
  './student.html',
  './editor.html',
  './escolhersetores.html',
  './chamada.html',
  './dashboard.html',
  './assets/app.css',
  './assets/api.js',
  './assets/editor.js',
  './assets/students.js',
  './assets/ui.js',
  './assets/attendance.css',
  './assets/attendance-api.js',
  './assets/loading.js',
  './assets/config2.js',
  './icons/favicon.svg'
];

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

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (!isCacheable(request)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(function (response) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || caches.match('./escolhersetores.html');
      });
    }));
    return;
  }

  event.respondWith(caches.match(request).then(function (cached) {
    const network = fetch(request).then(function (response) {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    });
    return cached || network;
  }));
});
