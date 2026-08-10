import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function filesIn(relativeDirectory, extension) {
  const directory = resolve(root, relativeDirectory);
  return (await readdir(directory)).filter((name) => extname(name) === extension)
    .map((name) => resolve(directory, name));
}

test('todos os JavaScripts versionados têm sintaxe válida', async () => {
  const files = [
    ...(await filesIn('assets', '.js')),
    resolve(root, 'service-worker.js')
  ];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
  }
});

test('solicitações exibem barra, spinner, mensagem e estado ocupado', async () => {
  const loading = await readFile(resolve(root, 'assets/loading.js'), 'utf8');
  const attendanceCss = await readFile(resolve(root, 'assets/attendance.css'), 'utf8');
  const profileCss = await readFile(resolve(root, 'assets/app.css'), 'utf8');
  assert.match(loading, /app-loading-bar/);
  assert.match(loading, /app-loading-spinner/);
  assert.match(loading, /app-loading-message/);
  assert.match(loading, /button\.setAttribute\('aria-busy'/);
  assert.match(attendanceCss, /@keyframes loading-bar/);
  assert.match(profileCss, /@keyframes app-loading-bar/);
});

test('páginas principais não apontam para arquivos locais inexistentes', async () => {
  const htmlFiles = [
    ...(await filesIn('.', '.html')),
    ...(await filesIn('setores', '.html'))
  ];
  const attribute = /(?:src|href)=["']([^"']+)["']/g;

  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    for (const match of html.matchAll(attribute)) {
      const reference = match[1];
      if (/^(?:https?:|\/\/|data:|mailto:|tel:|#)/i.test(reference)) continue;
      const clean = decodeURIComponent(reference.split(/[?#]/)[0]);
      if (!clean || clean.includes('${')) continue;
      await assert.doesNotReject(access(resolve(dirname(file), clean)), `${file} -> ${reference}`);
    }
  }
});

test('rotas antigas de setores redirecionam para a tela única', async () => {
  const sectorFiles = [
    ...(await filesIn('setores', '.html')),
    ...(await filesIn('img', '.html'))
  ];
  assert.ok(sectorFiles.length >= 20);
  for (const file of sectorFiles) {
    const html = await readFile(file, 'utf8');
    assert.match(html, /chamada\.html\?projeto=/, file);
    assert.doesNotMatch(html, /registrarFrequencia/, file);
  }
});

test('cada PNG de aluno tem uma versão WebP leve', async () => {
  const pngFiles = await filesIn('img', '.png');
  for (const file of pngFiles) {
    const base = file.slice(file.lastIndexOf('/') + 1, -4);
    await assert.doesNotReject(access(resolve(root, 'img/optimized', base + '.webp')), base);
  }
});

test('README está assinado pelo autor', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  assert.match(readme, /Bruno Agostinho/);
});
