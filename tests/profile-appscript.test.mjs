import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const apiFile = resolve('appscript/projeto7/Api.js');
const setupFile = resolve('appscript/projeto7/Código.js');
const apiSource = await readFile(apiFile, 'utf8');
const profileContext = vm.createContext({
  console,
  Date,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(algorithm, value) { return Array.from(String(value)).map(char => char.charCodeAt(0)); },
    base64EncodeWebSafe(value) { return Buffer.from(value).toString('base64url'); },
    formatDate(value, timezone, format) {
      const year = String(value.getFullYear()).padStart(4, '0');
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      const hour = String(value.getHours()).padStart(2, '0');
      const minute = String(value.getMinutes()).padStart(2, '0');
      const second = String(value.getSeconds()).padStart(2, '0');
      return format === 'yyyy-MM-dd' ? `${year}-${month}-${day}` : `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }
  },
  Session: { getScriptTimeZone() { return 'America/Recife'; } }
});
vm.runInContext(apiSource, profileContext, { filename: apiFile });

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
  assert.match(apiSource, /STUDENTS: 300/);
  assert.match(apiSource, /USERS: 300/);
  assert.match(apiSource, /function _readAuthCache_/);
  assert.match(apiSource, /function _writeAuthCache_/);
  assert.match(apiSource, /_writeAuthCache_\(token, \{/);
});

test('chave do cache de sessão não expõe o token', () => {
  const token = 'token-super-secreto';
  const key = profileContext._authCacheKey_(token);
  assert.match(key, /^profile-api:v2:auth:/);
  assert.doesNotMatch(key, new RegExp(token));
});

test('datas de planilha são entregues no formato aceito pelo navegador', () => {
  const value = new Date(2008, 4, 12, 12, 0, 0);
  assert.equal(profileContext._serializeSheetCell_(value, 'birth_date'), '2008-05-12');
  assert.equal(profileContext._normalizeStudentDate_('12/05/2008'), '2008-05-12');
  assert.equal(profileContext._normalizeStudentDate_('2008-02-31'), '');
});

test('alteração parcial da foto preserva nascimento, idade e observações', () => {
  const existing = {
    student_id: 'ST-001', name: 'Ana Beatriz', birth_date: '2008-05-12', age: '17',
    photo_url: 'img/antiga.png', notes: 'Acompanhamento reservado', status: 'ACTIVE', created_at: '2025-01-01'
  };
  const updated = profileContext._buildStudentRow_(existing, {
    student_id: 'ST-001', photo_url: 'img/nova.png', update_mask: ['photo_url']
  }, { studentId: 'ST-001', now: '2026-08-10 17:00:00', countryCode: '55', isNew: false });

  assert.equal(updated.photo_url, 'img/nova.png');
  assert.equal(updated.birth_date, '2008-05-12');
  assert.equal(updated.age, '17');
  assert.equal(updated.notes, 'Acompanhamento reservado');
  assert.deepEqual(Array.from(profileContext._studentColumnsForMask_(['photo_url'])), ['photo_url', 'updated_at']);
});

test('persistência parcial escreve somente foto e horário de atualização', () => {
  const headers = [
    'student_id', 'name', 'sex', 'birth_date', 'age', 'phone_e164', 'phone_display', 'whatsapp_link',
    'photo_url', 'scholarship_type_id', 'scholarship_type_name', 'sector_current_id', 'sector_current_name',
    'workload_minutes', 'status', 'notes', 'created_at', 'updated_at'
  ];
  const writes = [];
  const sheet = {
    getName() { return 'TEST_STUDENTS'; },
    getLastColumn() { return headers.length; },
    getRange(row, column, rowCount, columnCount) {
      if (row === 1) return { getValues() { return [headers]; } };
      return { setValues(values) { writes.push({ row, column, rowCount, columnCount, values }); } };
    }
  };

  profileContext._updateObjectFields_(sheet, 7, {
    photo_url: 'img/nova.png', updated_at: '2026-08-10 17:00:00'
  }, ['photo_url', 'updated_at']);

  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [
    { row: 7, column: 9, rowCount: 1, columnCount: 1, values: [['img/nova.png']] },
    { row: 7, column: 18, rowCount: 1, columnCount: 1, values: [['2026-08-10 17:00:00']] }
  ]);
});

test('campo de nascimento vazio de cliente antigo não apaga a data existente', () => {
  const existing = { student_id: 'ST-001', name: 'Ana', birth_date: '2008-05-12', age: '17', status: 'ACTIVE' };
  const updated = profileContext._buildStudentRow_(existing, {
    student_id: 'ST-001', name: 'Ana', birth_date: '', photo_url: 'img/nova.png'
  }, { studentId: 'ST-001', now: '2026-08-10 17:00:00', countryCode: '55', isNew: false });
  assert.equal(updated.birth_date, '2008-05-12');
  assert.equal(updated.age, '17');
});

test('remoção intencional da data exige sinalização explícita', () => {
  const existing = { student_id: 'ST-001', name: 'Ana', birth_date: '2008-05-12', age: '18', status: 'ACTIVE' };
  const updated = profileContext._buildStudentRow_(existing, {
    student_id: 'ST-001', birth_date: '', clear_birth_date: true, update_mask: ['birth_date']
  }, { studentId: 'ST-001', now: '2026-08-10 17:00:00', countryCode: '55', isNew: false });
  assert.equal(updated.birth_date, '');
  assert.equal(updated.age, '');
});
