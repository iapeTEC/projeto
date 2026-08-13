import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

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

test('scripts inline das páginas têm sintaxe válida', async () => {
  const htmlFiles = await filesIn('.', '.html');
  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    const inlineScripts = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi));
    for (const match of inlineScripts) {
      assert.doesNotThrow(() => new vm.Script(match[1], { filename: file }), file);
    }
  }
});

test('editor seleciona alunos sem expor ID ou usar modais aninhados', async () => {
  const html = await readFile(resolve(root, 'editor.html'), 'utf8');
  const script = await readFile(resolve(root, 'assets/editor.js'), 'utf8');
  assert.match(html, /id="studentEditorList"/);
  assert.match(html, /type="hidden" id="st_id"/);
  assert.match(html, /assets\/editor\.js/);
  assert.doesNotMatch(html, /studentPickerModal|cardModal|btnOpenStudentPicker/);
  assert.match(script, /function selectStudent\(/);
  assert.match(script, /findStudent\(studentId\)/);
  assert.match(script, /update_mask/);
  assert.match(script, /function buildStudentRequest\(/);
  assert.match(script, /clear_birth_date/);
});

test('login passwordless usa e-mail, código temporário e sessão por aba', async () => {
  const html = await readFile(resolve(root, 'login.html'), 'utf8');
  const api = await readFile(resolve(root, 'assets/api.js'), 'utf8');
  assert.match(html, /id="email"[^>]+type="email"/);
  assert.match(html, /id="loginCode"[^>]+autocomplete="one-time-code"/);
  assert.match(html, /apiPost\('requestLoginCode', \{ email: email \}\)/);
  assert.match(html, /apiPost\('verifyLoginCode', payload\)/);
  assert.doesNotMatch(html, /type="password"|current-password|apiPost\(["']login["']/);
  assert.match(api, /sessionStorage\.setItem\(key, value\)/);
  assert.match(api, /localStorage\.removeItem\(SESSION_KEYS\[name\]\)/);
  assert.doesNotMatch(api, /localStorage\.setItem\(/);
  assert.match(api, /user_id \|\| user\.email/);
  assert.match(api, /handleAuthFailure/);
});

test('RBAC expõe quatro papéis e gestão de acesso somente ao proprietário', async () => {
  const html = await readFile(resolve(root, 'editor.html'), 'utf8');
  const editor = await readFile(resolve(root, 'assets/editor.js'), 'utf8');
  const ui = await readFile(resolve(root, 'assets/ui.js'), 'utf8');
  for (const role of ['OWNER', 'ADMIN', 'EDITOR', 'USER']) assert.match(ui, new RegExp(`${role}: '${role}'`));
  assert.match(ui, /MANAGE_ACCESS: 'access:manage'/);
  assert.match(ui, /OWNER: Object\.values\(CAPABILITIES\)/);
  assert.match(editor, /requireCapability\(window\.UI\.CAPABILITIES\.EDIT_ACADEMIC\)/);
  assert.match(html, /data-editor-tab="users" data-required-capability="access:manage"/);
  assert.match(html, /id="access_email" type="email"/);
  assert.match(html, /value="ADMIN"/);
  assert.match(html, /value="EDITOR"/);
  assert.match(html, /value="USER"/);
  assert.doesNotMatch(html, /value="OWNER"/);
  assert.match(editor, /apiPost\('listUsers'/);
  assert.match(editor, /apiPost\('upsertUser'/);
  assert.match(editor, /apiPost\('revokeUserSessions'/);
});

test('módulo de frequência preserva APIs separadas e envia sessão em POST', async () => {
  const profileConfig = await readFile(resolve(root, 'assets/config.js'), 'utf8');
  const attendanceConfig = await readFile(resolve(root, 'assets/config2.js'), 'utf8');
  const attendanceApi = await readFile(resolve(root, 'assets/attendance-api.js'), 'utf8');
  assert.match(profileConfig, /window\.PROFILE_APP_CONFIG/);
  assert.match(attendanceConfig, /window\.ATTENDANCE_APP_CONFIG/);
  assert.match(attendanceApi, /window\.ATTENDANCE_APP_CONFIG/);
  assert.match(attendanceApi, /method: 'POST'/);
  assert.match(attendanceApi, /\{ token: session\.token \}/);

  for (const name of ['dashboard.html', 'escolhersetores.html', 'chamada.html']) {
    const html = await readFile(resolve(root, name), 'utf8');
    assert.match(html, /assets\/config\.js/);
    assert.match(html, /assets\/config2\.js/);
    assert.match(html, /assets\/api\.js/);
    assert.match(html, /assets\/ui\.js/);
    assert.match(html, /id="attendance(?:-account|Account)"/);
  }
  const dashboard = await readFile(resolve(root, 'assets/dashboard.js'), 'utf8');
  const sectors = await readFile(resolve(root, 'escolhersetores.html'), 'utf8');
  const attendance = await readFile(resolve(root, 'chamada.html'), 'utf8');
  assert.match(dashboard, /CAPABILITIES\.VIEW_ATTENDANCE/);
  assert.match(sectors, /CAPABILITIES\.RECORD_ATTENDANCE/);
  assert.match(attendance, /CAPABILITIES\.RECORD_ATTENDANCE/);
});

test('perfil e relatório interrompem a execução sem usuário autenticado', async () => {
  for (const name of ['student.html', 'sponsor.html']) {
    const html = await readFile(resolve(root, name), 'utf8');
    assert.match(html, /const user = window\.UI\.requireAuth\(\);\s*if\s*\(!user\) return;/);
  }
});

test('diretório oferece busca de alunos instantânea fora dos filtros', async () => {
  const html = await readFile(resolve(root, 'students.html'), 'utf8');
  const script = await readFile(resolve(root, 'assets/students.js'), 'utf8');
  const searchIndex = html.indexOf('id="studentSearchPanel"');
  const inputIndex = html.indexOf('id="f_q"');
  const filtersIndex = html.indexOf('id="filters"');
  assert.ok(searchIndex >= 0 && inputIndex > searchIndex && filtersIndex > inputIndex);
  assert.match(html, /id="studentSuggestions"/);
  assert.match(script, /byId\('f_q'\)\.addEventListener\('input', renderDirectory\)/);
  assert.match(script, /function renderSuggestions\(/);
  assert.match(script, /filters: \{\}, include_meta: 'TRUE'/);
});

test('solicitações exibem barra, spinner, mensagem e estado ocupado', async () => {
  const loading = await readFile(resolve(root, 'assets/loading.js'), 'utf8');
  const profileApi = await readFile(resolve(root, 'assets/api.js'), 'utf8');
  const attendanceApi = await readFile(resolve(root, 'assets/attendance-api.js'), 'utf8');
  const attendanceCss = await readFile(resolve(root, 'assets/attendance.css'), 'utf8');
  const profileCss = await readFile(resolve(root, 'assets/app.css'), 'utf8');
  assert.match(loading, /app-loading-bar/);
  assert.match(loading, /app-loading-spinner/);
  assert.match(loading, /app-loading-message/);
  assert.match(loading, /button\.setAttribute\('aria-busy'/);
  assert.match(attendanceCss, /@keyframes loading-bar/);
  assert.match(profileCss, /@keyframes app-loading-bar/);
  assert.match(profileApi, /REQUEST_TIMEOUT_MS = 90000/);
  assert.match(attendanceApi, /REQUEST_TIMEOUT_MS = 90000/);
  assert.match(profileApi, /Continuamos tentando/);
  assert.match(attendanceApi, /Continuamos tentando/);
});

test('dashboard prioriza alunos com faltas e permite filtrar setores rapidamente', async () => {
  const html = await readFile(resolve(root, 'dashboard.html'), 'utf8');
  const script = await readFile(resolve(root, 'assets/dashboard.js'), 'utf8');
  assert.match(html, /id="attention-list"/);
  assert.match(html, /id="sector-overview"/);
  assert.match(html, /id="absence-threshold"/);
  assert.match(html, /id="attendanceAccount"/);
  assert.match(script, /requireCapability\(window\.UI\.CAPABILITIES\.VIEW_ATTENDANCE\)/);
  assert.match(script, /mountAttendanceAccount\('attendanceAccount', user\)/);
  assert.match(script, /rankingAlunos/);
  assert.match(script, /function selectProject\(/);
  assert.match(script, /function dataForProject\(/);
  assert.match(script, /if \(state\.allData\) render\(dataForProject/);
  assert.match(script, /function buildPrintReport\(/);
  assert.match(script, /AttendanceApi\.getDashboard\(filters/);
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
