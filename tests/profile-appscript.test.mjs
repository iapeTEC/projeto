import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const apiFile = resolve('appscript/projeto7/Api.js');
const setupFile = resolve('appscript/projeto7/Código.js');
const apiSource = await readFile(apiFile, 'utf8');

test('backend de perfis versionado tem sintaxe válida', () => {
  for (const file of [apiFile, setupFile]) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
  }
});

test('rotas agregadas evitam várias inicializações do Apps Script', () => {
  assert.match(apiSource, /case "getHomeOverview"/);
  assert.match(apiSource, /case "getStudentDirectory"/);
  assert.match(apiSource, /case "getEditorBootstrap"/);
  assert.match(apiSource, /case "getStudentProfile"/);
});

test('primeiro usuário não possui senha padrão no código', () => {
  assert.match(apiSource, /seedInitialUserFromProperties/);
  assert.doesNotMatch(apiSource, /const password = ["'][^"']+["']/);
  assert.match(apiSource, /deleteProperty\("INITIAL_USER_PASSWORD"\)/);
});

test('leituras estáveis usam cache com invalidação após escrita', () => {
  assert.match(apiSource, /PROFILE_CACHEABLE_SHEETS/);
  assert.match(apiSource, /function _invalidateSheetCache_/);
  assert.match(apiSource, /_invalidateSheetCache_\(sheet\.getName\(\)\)/);
});
