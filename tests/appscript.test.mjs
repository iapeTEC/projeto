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

test('o dashboard agrega independentemente de rows=0', () => {
  assert.match(source, /summaryMap\[project\]/);
  assert.doesNotMatch(source, /rowsOut\.forEach\([^]*resumoMap/);
});
