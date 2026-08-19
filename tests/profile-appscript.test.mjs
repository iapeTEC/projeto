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

test('proprietário é criado automaticamente sem senha ou hash reutilizável', () => {
  assert.match(apiSource, /PROFILE_OWNER_EMAIL = "normafederal@gmail\.com"/);
  assert.match(apiSource, /function _ensureAuthSchemaAndOwner_/);
  assert.match(apiSource, /role:\s*"OWNER"/);
  assert.match(apiSource, /password_hash:\s*""/);
  assert.match(apiSource, /migratedRole === "OWNER" \? "ADMIN" : migratedRole/);
  assert.match(apiSource, /normalizedRole === "OWNER" \? "ADMIN" : normalizedRole/);
  assert.doesNotMatch(apiSource, /const password = ["'][^"']+["']/);
});

test('envio de código limita tentativas por e-mail e também a cota global', () => {
  assert.match(apiSource, /PROFILE_LOGIN_GLOBAL_HOURLY_LIMIT = 100/);
  assert.match(apiSource, /otp-hour:" \+ emailKey/);
  assert.match(apiSource, /otp-hour:global/);
  assert.match(apiSource, /if \(allowed\) cache\.put\(globalHourlyKey/);
  assert.match(apiSource, /hourlyCount < 6 && globalHourlyCount < PROFILE_LOGIN_GLOBAL_HOURLY_LIMIT/);
  assert.match(apiSource, /function authorizeMailForLogin\(\)/);
  assert.match(apiSource, /MailApp\.getRemainingDailyQuota\(\)/);
});

test('leituras estáveis usam cache com invalidação após escrita', () => {
  assert.match(apiSource, /PROFILE_CACHEABLE_SHEETS/);
  assert.match(apiSource, /function _invalidateSheetCache_/);
  assert.match(apiSource, /_invalidateSheetCache_\(sheet\.getName\(\)\)/);
  assert.match(apiSource, /STUDENTS: 300/);
  assert.match(apiSource, /USERS: 300/);
  assert.match(apiSource, /function _readAuthCache_/);
  assert.match(apiSource, /function _writeAuthCache_/);
  assert.match(apiSource, /_writeAuthCache_\(token, /);
});

test('chave do cache de sessão não expõe o token', () => {
  const token = 'token-super-secreto';
  const key = profileContext._authCacheKey_(token);
  assert.match(key, /^profile-api:v\d+:auth:/);
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

test('avaliações e alunos usam cache com invalidação após qualquer escrita', () => {
  assert.match(apiSource, /EVALUATIONS: 120/);
  assert.match(apiSource, /function _getStudentById_\([^]*?_getAll_\("STUDENTS"\)\.find/);
  assert.match(apiSource, /function _appendObjectRow_\([^]*?_invalidateSheetCache_\(sheet\.getName\(\)\)/);
  assert.match(apiSource, /function _updateObjectRow_\([^]*?_invalidateSheetCache_\(sheet\.getName\(\)\)/);
});

test('sessões antigas são reutilizadas com carência e trava, sem deslocar linhas ativas', () => {
  assert.match(apiSource, /function _takeReusableSessionRow_/);
  assert.match(apiSource, /sessions:reusable-rows/);
  assert.match(apiSource, /now - 24 \* 60 \* 60 \* 1000/);
  assert.match(apiSource, /LockService\.getScriptLock\(\)/);
  assert.match(apiSource, /function _appendObjectRow_\([^]*?sheet\.getName\(\) === "SESSIONS"[^]*?_writeSessionRow_/);
  assert.doesNotMatch(apiSource, /function _takeReusableSessionRow_\([^]*?deleteRows\(/);

  const oldExpiry = profileContext._sessionExpiryMillis_('2020-03-04 05:06:07');
  assert.equal(oldExpiry, new Date(2020, 2, 4, 5, 6, 7).getTime());
  assert.equal(profileContext._sessionExpiryMillis_('2020-03-04T05:06:07.000Z'), Date.parse('2020-03-04T05:06:07.000Z'));
  assert.equal(profileContext._sessionExpiryMillis_(''), Number.POSITIVE_INFINITY);
});

test('consulta de sessão usa busca exata e indexada pelo hash', () => {
  assert.match(apiSource, /function _findRowByKeyText_/);
  assert.match(apiSource, /createTextFinder\(String\(keyValue\)\)/);
  assert.match(apiSource, /\.matchEntireCell\(true\)\s*\.matchCase\(true\)/);
  assert.match(apiSource, /const idx = _findRowByKeyText_\(sh, key, value\)/);
});

test('sessões revogadas são rejeitadas mesmo quando a planilha devolve booleano', () => {
  assert.match(apiSource, /function _isTruthy_\(value\)/);
  assert.match(apiSource, /if \(_isTruthy_\(sess\.revoked\)\) throw new Error\("Session revoked"\)/);
  assert.match(apiSource, /if \(_isTruthy_\(cached\.session\.revoked\)\) return null/);
});

test('sessões com expiração inválida ou vencida falham fechadas', () => {
  assert.match(apiSource, /const expiresAt = new Date\(sess\.expires_at\)\.getTime\(\);\s*if \(!isFinite\(expiresAt\) \|\| expiresAt <= Date\.now\(\)\) throw new Error\("Session expired"\)/);
  assert.match(apiSource, /const expiresAt = new Date\(cached\.session\.expires_at\)\.getTime\(\);\s*if \(!isFinite\(expiresAt\) \|\| expiresAt <= Date\.now\(\)\) return null/);
});

function withGoogleStubs(claims, { responseCode = 200, clientId = 'client-abc.apps.googleusercontent.com' } = {}) {
  const cache = new Map();
  const fetched = [];
  profileContext.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: name => (name === 'GOOGLE_CLIENT_ID' ? clientId : null),
      setProperty() {}
    })
  };
  profileContext.CacheService = {
    getScriptCache: () => ({
      get: key => (cache.has(key) ? cache.get(key) : null),
      put: (key, value) => cache.set(key, value),
      remove: key => cache.delete(key)
    })
  };
  profileContext.UrlFetchApp = {
    fetch(url) {
      fetched.push(url);
      return {
        getResponseCode: () => responseCode,
        getContentText: () => JSON.stringify(claims)
      };
    }
  };
  return { cache, fetched };
}

const validClaims = () => ({
  aud: 'client-abc.apps.googleusercontent.com',
  iss: 'https://accounts.google.com',
  exp: Math.floor(Date.now() / 1000) + 1800,
  email: 'Pessoa@IAPE.Tech',
  email_verified: 'true',
  sub: '110000000000000000001',
  name: 'Pessoa Autorizada',
  picture: 'https://lh3.googleusercontent.com/foto'
});

const longToken = 'x'.repeat(400);

// assert.throws compara com instanceof, e os erros nascem dentro do vm — outro
// realm, outro Error. Aqui basta saber que recusou (e, se pedido, com qual texto).
function recusou(run, expectedMessage) {
  try {
    run();
    return false;
  } catch (error) {
    return expectedMessage ? expectedMessage.test(String(error && error.message)) : true;
  }
}

test('login Google aceita apenas token do próprio aplicativo, emitido pelo Google e no prazo', () => {
  const ok = withGoogleStubs(validClaims());
  const identity = profileContext._verifyGoogleIdToken_(longToken);
  assert.equal(identity.email, 'pessoa@iape.tech');
  assert.equal(identity.subject, '110000000000000000001');
  assert.equal(identity.name, 'Pessoa Autorizada');
  assert.equal(ok.fetched.length, 1);

  // O mesmo token não paga um segundo UrlFetch: a identidade fica em cache.
  profileContext._verifyGoogleIdToken_(longToken);
  assert.equal(ok.fetched.length, 1);

  const recusas = [
    ['audiência de outro aplicativo', { ...validClaims(), aud: 'outro.apps.googleusercontent.com' }],
    ['emissor falso', { ...validClaims(), iss: 'https://evil.example.com' }],
    ['token vencido', { ...validClaims(), exp: Math.floor(Date.now() / 1000) - 10 }],
    ['e-mail não verificado', { ...validClaims(), email_verified: 'false' }],
    ['identidade incompleta', { ...validClaims(), sub: '' }]
  ];
  for (const [motivo, claims] of recusas) {
    withGoogleStubs(claims);
    assert.equal(recusou(() => profileContext._verifyGoogleIdToken_('y'.repeat(400))), true, motivo);
  }

  withGoogleStubs(validClaims(), { responseCode: 401 });
  assert.equal(recusou(() => profileContext._verifyGoogleIdToken_('z'.repeat(400))), true, 'resposta 401 do Google');

  // Sem propriedade de script, vale o Client ID versionado no código — publicar
  // o Web App já deixa o login pronto, sem um passo manual no console.
  profileContext.PropertiesService = {
    getScriptProperties: () => ({ getProperty: () => '', setProperty() {} })
  };
  assert.match(profileContext._googleClientId_(), /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);

  // A propriedade de script continua tendo prioridade, para trocar sem publicar.
  profileContext.PropertiesService = {
    getScriptProperties: () => ({ getProperty: () => 'trocado.apps.googleusercontent.com', setProperty() {} })
  };
  assert.equal(profileContext._googleClientId_(), 'trocado.apps.googleusercontent.com');
});

test('rota de login Google é pública e o cadastro guarda a identidade da conta', () => {
  assert.match(apiSource, /action === "loginWithGoogle"/);
  // Precisa ficar acima de _requireAuth_: quem entra ainda não tem sessão.
  assert.ok(
    apiSource.indexOf('action === "loginWithGoogle"') < apiSource.indexOf('const auth = _requireAuth_(req);'),
    'loginWithGoogle deve ser resolvida antes da exigência de sessão'
  );
  assert.match(apiSource, /"google_subject", "display_name", "avatar_url"/);
  assert.match(apiSource, /AUTH_SCHEMA_VERSION", "4"/);
  // Conta sem cadastro ou desativada não recebe sessão.
  assert.match(apiSource, /if \(!user \|\| String\(user\.active \|\| ""\)\.toUpperCase\(\) !== "TRUE"\)/);
});
