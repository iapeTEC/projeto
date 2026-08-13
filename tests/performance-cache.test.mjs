import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const studentsSource = await readFile(new URL('../assets/students.js', import.meta.url), 'utf8');
const studentPageSource = await readFile(new URL('../student.html', import.meta.url), 'utf8');

function loadWorker(fetchImpl, initialCache = new Map()) {
  const listeners = {};
  const fetchCalls = [];
  const cache = new Map(initialCache);
  const keyFor = request => typeof request === 'string' ? request : request.url;
  const context = {
    URL,
    Set,
    Response,
    fetch(request, options) {
      fetchCalls.push({ request, options });
      return fetchImpl(request, options);
    },
    caches: {
      async open() {
        return {
          async addAll() {},
          async put(request, response) { cache.set(keyFor(request), response); }
        };
      },
      async match(request) { return cache.get(keyFor(request)); },
      async keys() { return []; },
      async delete() { return true; }
    },
    self: {
      location: { origin: 'https://example.test' },
      registration: { scope: 'https://example.test/projeto/' },
      clients: { async claim() {} },
      async skipWaiting() {},
      addEventListener(type, listener) { listeners[type] = listener; }
    }
  };
  vm.runInNewContext(workerSource, context, { filename: 'service-worker.js' });
  return { listeners, fetchCalls, cache };
}

test('service worker mantém o shell completo e renova clientes/configurações pela rede', () => {
  assert.match(workerSource, /iape-gestao-estudantil-v8/);
  const requiredShellFiles = [
    'login.html', 'index.html', 'students.html', 'student.html', 'sponsor.html', 'editor.html',
    'escolhersetores.html', 'chamada.html', 'dashboard.html', 'assets/config.js',
    'assets/config2.js', 'assets/api.js', 'assets/attendance-api.js', 'assets/dashboard.js'
  ];
  requiredShellFiles.forEach(file => assert.match(workerSource, new RegExp(`['"]\\./${file.replaceAll('.', '\\.')}`), file));

  ['assets/config.js', 'assets/config2.js', 'assets/api.js', 'assets/attendance-api.js']
    .forEach(file => assert.match(workerSource, new RegExp(`['"]${file.replaceAll('.', '\\.')}`), file));
  assert.match(workerSource, /networkFirst\(request, \{ cache: 'no-store' \}\)/);
  assert.match(workerSource, /networkFirst\(request, \{ cache: 'no-store' \}, '\.\/login\.html'\)/);
});

test('atualização em segundo plano é vinculada ao evento e trata falha de rede', () => {
  assert.match(workerSource, /const backgroundUpdate = fetchAndCache\(request\)\.catch/);
  assert.match(workerSource, /event\.waitUntil\(backgroundUpdate\)/);
  assert.doesNotMatch(workerSource, /caches\.open\(CACHE_NAME\)\.then\(function \(cache\) \{ cache\.put/);
});

test('configuração ignora o cache HTTP, atualiza o fallback offline e devolve a rede', async () => {
  const url = 'https://example.test/projeto/assets/config.js';
  const worker = loadWorker(async () => new Response('fresh', { status: 200 }));
  let responsePromise;
  worker.listeners.fetch({
    request: { method: 'GET', mode: 'cors', url },
    respondWith(value) { responsePromise = value; },
    waitUntil() { assert.fail('network-first não deve soltar trabalho em segundo plano'); }
  });

  const response = await responsePromise;
  assert.equal(await response.text(), 'fresh');
  assert.equal(worker.fetchCalls[0].options.cache, 'no-store');
  assert.equal(await (worker.cache.get(url)).text(), 'fresh');
});

test('asset estático em cache continua disponível quando a atualização de rede falha', async () => {
  const url = 'https://example.test/projeto/assets/app.css';
  const initialCache = new Map([[url, new Response('cached', { status: 200 })]]);
  const worker = loadWorker(async () => { throw new Error('offline'); }, initialCache);
  let responsePromise;
  let lifetimePromise;
  worker.listeners.fetch({
    request: { method: 'GET', mode: 'cors', url },
    respondWith(value) { responsePromise = value; },
    waitUntil(value) { lifetimePromise = value; }
  });

  const response = await responsePromise;
  assert.equal(await response.text(), 'cached');
  assert.equal(await lifetimePromise, null);
});

test('diretório prefere WebP leve e conserva PNG e iniciais como fallback', () => {
  assert.match(studentsSource, /img\/optimized\/.*\.webp/);
  assert.match(studentsSource, /data-photo-fallback/);
  assert.match(studentsSource, /data-photo-initials/);
  assert.match(studentsSource, /document\.addEventListener\('error'/);
  assert.match(studentsSource, /loading="lazy" decoding="async"/);
  assert.match(studentPageSource, /img\/optimized\/.*\.webp/);
  assert.match(studentPageSource, /addEventListener\("error"/);
});

test('páginas que consultam os Web Apps aquecem os dois hosts do Google', async () => {
  const pages = [
    'login.html', 'index.html', 'editor.html', 'students.html', 'student.html', 'sponsor.html',
    'escolhersetores.html', 'chamada.html', 'dashboard.html'
  ];
  for (const page of pages) {
    const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
    assert.match(html, /rel="preconnect" href="https:\/\/script\.google\.com"/, page);
    assert.match(html, /rel="preconnect" href="https:\/\/script\.googleusercontent\.com"/, page);
  }
});
