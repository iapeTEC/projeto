import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../appscript/Code.gs', import.meta.url), 'utf8');
const context = vm.createContext({ console, Date, JSON, Object, Array, String, Number, Math });
vm.runInContext(source, context, { filename: 'Code.gs' });

test('normaliza nomes de projetos sem perder a equivalência', () => {
  assert.equal(context.normalizeProjectKey_('  Coordenação   Pedagógica '), 'COORDENACAO PEDAGOGICA');
  assert.equal(context.canonicalProjectName_('r.h.'), 'R.H.');
});

test('gera foto de fallback a partir do primeiro e do último nome', () => {
  assert.equal(context.fallbackPhotoFromName_('Álvaro de Souza'), 'img/alvarosouza.png');
  assert.equal(context.fallbackPhotoFromName_(''), '');
});

test('remove linhas contíguas em lotes e de baixo para cima', () => {
  const calls = [];
  const sheet = { deleteRows(start, count) { calls.push([start, count]); } };
  context.deleteRowsInRuns_(sheet, [2, 3, 4, 8, 10, 11]);
  assert.deepEqual(calls, [[10, 2], [8, 1], [2, 3]]);
});

test('não mantém IDs de planilhas hardcoded no código versionado', () => {
  assert.doesNotMatch(source, /1[\w-]{30,}/);
  assert.match(source, /ATTENDANCE_SPREADSHEET_ID/);
  assert.match(source, /SOURCE_ROSTER_SPREADSHEET_ID/);
});

test('API de frequência exige a sessão compartilhada e respeita papéis', () => {
  assert.match(source, /requireAttendanceAuth_\(body, ATTENDANCE_READ_ROLES, true\)/);
  assert.match(source, /requireAttendanceAuth_\(body, ATTENDANCE_WRITE_ROLES, false\)/);
  assert.match(source, /sessionHeaders\.indexOf\('token_hash'\) === -1/);
  assert.match(source, /attendanceFindRow_\(sessions, sessionHeaders, 'token_hash', tokenHash\)/);
  assert.doesNotMatch(source, /\? 'token_hash' : 'session_token'/);
  assert.match(source, /\.matchEntireCell\(true\)\s*\.matchCase\(true\)/);
  assert.doesNotMatch(source, /acao === ''/);

  const readRoles = ['OWNER', 'ADMIN', 'EDITOR', 'USER'];
  const writeRoles = ['OWNER', 'ADMIN', 'EDITOR'];
  assert.doesNotThrow(() => context.requireAttendanceRole_({ role: 'USER' }, readRoles));
  assert.throws(
    () => context.requireAttendanceRole_({ role: 'USER' }, writeRoles),
    (error) => error && error.code === 403
  );
  assert.doesNotThrow(() => context.requireAttendanceRole_({ role: 'EDITOR' }, writeRoles));
});

test('o dashboard agrega independentemente de rows=0', () => {
  assert.match(source, /function aggregateAttendanceRows_/);
  assert.match(source, /summaryMap\[projectKey\]/);
  assert.match(source, /includeRows: includeRows/);
  assert.doesNotMatch(source, /rowsOut\.forEach\([^]*summaryMap/);
});

test('dashboard ordena alunos por faltas, aplica limiar e não expõe identificadores internos', () => {
  const rows = [
    ['2026-08-01', 'Academia', 'Profa. Ana', 'Aluna B', 0, 1, 'Conversar', 'MANUAL'],
    ['2026-08-02', 'Academia', 'Profa. Ana', 'Aluna A', 1, 0, '', 'MANUAL'],
    ['2026-08-03', 'Academia', 'Profa. Ana', 'Aluna B', 0, 0, '', 'MANUAL'],
    ['2026-08-04', 'Coral', 'Prof. Caio', 'Aluno C', 0, 0, '', 'MANUAL'],
    ['2026-08-05', 'Academia', 'Profa. Ana', 'Aluna A', 0, 0, '', 'MANUAL']
  ];
  const result = context.aggregateAttendanceRows_(rows, {
    zone: 'America/Recife', start: '2026-08-01', end: '2026-08-31', includeRows: true,
    absencesOnly: true, rowLimit: 50, minAbsences: 2, rankingLimit: 10
  });

  assert.equal(result.metrics.faltas, 4);
  assert.equal(result.metrics.alunosComFalta, 3);
  assert.equal(result.rankingAlunos.length, 1);
  assert.equal(result.rankingAlunos[0].student, 'Aluna B');
  assert.equal(result.rankingAlunos[0].faltas, 2);
  assert.equal(result.rankingAlunos[0].faltasConsecutivas, 2);
  assert.equal(result.resumoPorGrupo[0].group, 'Academia');
  assert.equal(result.resumoPorGrupo[0].alunosComFalta, 2);
  assert.equal(result.rows.length, 4);
  assert.ok(result.rankingAlunos.every((item) => !('id' in item) && !('email' in item)));
});

test('dashboard filtra setor sem depender das linhas devolvidas', () => {
  const rows = [
    ['2026-08-01', 'Academia', '', 'Ana', 0, 0, '', 'MANUAL'],
    ['2026-08-01', 'Coral', '', 'Bia', 1, 0, '', 'MANUAL']
  ];
  const result = context.aggregateAttendanceRows_(rows, {
    zone: 'America/Recife', start: '2026-08-01', end: '2026-08-31',
    filterKey: 'ACADEMIA', includeRows: false, minAbsences: 1
  });

  assert.equal(result.metrics.totalLancamentos, 1);
  assert.equal(result.metrics.faltas, 1);
  assert.equal(result.resumoPorGrupo.length, 1);
  assert.equal(result.rows.length, 0);
  assert.equal(result.rowsMeta.matched, 1);
});
