/**
 * API de frequencia dos projetos.
 *
 * Configuracao recomendada em Project Settings > Script Properties:
 * - ATTENDANCE_SPREADSHEET_ID
 * - SOURCE_ROSTER_SPREADSHEET_ID
 *
 * Configuracao opcional:
 * - ADMIN_TOKEN (protege a execucao manual da presenca automatica via HTTP)
 */

const APP_VERSION = '2.1.0';
const DEFAULT_TZ = 'America/Recife';

const SOURCE_ROSTER_SHEET_NAME = 'STUDENTS';
const SOURCE_SECTORS_SHEET_NAME = 'SECTORS';
const ATTENDANCE_SHEET_NAME = 'Attendance';
const GROUPS_SHEET_NAME = 'Groups';

const SOURCE_FIRST_DATA_ROW = 2;
const SOURCE_COL_STUDENT = 2;
const SOURCE_COL_PHOTO = 9;
const SOURCE_COL_PROJECT = 13;

const SECTORS_FIRST_DATA_ROW = 2;
const SECTORS_COL_PROJECT = 2;

const ATTENDANCE_COLUMNS = 9;
const CACHE_TTL_SECONDS = 300;
const DASHBOARD_CACHE_TTL_SECONDS = 90;
const CACHE_KEY_ROSTER = 'roster:v2';
const CACHE_KEY_SECTORS = 'sectors:v2';
const CACHE_KEY_ATTENDANCE_VERSION = 'attendance:version';

const VALID_PROJECTS = Object.freeze([
  'Monitoria Escolar',
  'Residencial Feminino',
  'Academia',
  'Capelania',
  'Coral',
  'e-Class',
  'Enfermaria',
  'Esporte',
  'Hotelaria',
  'Jardim',
  'Audiovisual',
  'Marketing',
  'Pastoral',
  'Restaurante',
  'Secretaria',
  'R.H.',
  'Contabilidade',
  'Projeto',
  'Residencial Masculino',
  'Coordenação Pedagógica'
]);

let spreadsheetCache_ = {};

/***********************
 * HTTP
 ***********************/
function doGet(e) {
  try {
    const p = e && e.parameter ? e.parameter : {};
    const acao = String(p.acao || '').toLowerCase();

    if (!acao) {
      return respond_({ status: 'ok', message: 'webapp up', version: APP_VERSION });
    }

    if (acao === 'rosterprojeto') return rosterProjeto_(p);
    if (acao === 'dashboard') return consultarDashboard_(p);
    if (acao === 'listaprojetos') return listaProjetos_();
    if (acao === 'rodarpresencaautomaticaagora') {
      if (!isAdminRequest_(p)) {
        return respond_({ status: 'error', message: 'Não autorizado.' });
      }
      return respond_({ status: 'success', ...processarPresencaAutomaticaHoje_() });
    }

    return respond_({ status: 'error', message: 'Ação GET inválida: ' + acao });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return respond_({ status: 'error', message: safeErrorMessage_(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respond_({ status: 'error', message: 'Body vazio.' });
    }

    const body = JSON.parse(e.postData.contents || '{}');
    const acao = String(body.acao || '').toLowerCase();

    if (acao === 'registrarfrequencia' || acao === 'registrarapontamento' || acao === '') {
      return registrar_(body);
    }

    return respond_({ status: 'error', message: 'Ação inválida: ' + acao });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return respond_({ status: 'error', message: safeErrorMessage_(err) });
  }
}

/***********************
 * CONFIGURACAO E CACHE
 ***********************/
function getRequiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Configure a Script Property ' + name + '.');
  return value;
}

function openSpreadsheet_(propertyName) {
  if (!spreadsheetCache_[propertyName]) {
    spreadsheetCache_[propertyName] = SpreadsheetApp.openById(getRequiredProperty_(propertyName));
  }
  return spreadsheetCache_[propertyName];
}

function getAttendanceSpreadsheet_() {
  return openSpreadsheet_('ATTENDANCE_SPREADSHEET_ID');
}

function getSourceSpreadsheet_() {
  return openSpreadsheet_('SOURCE_ROSTER_SPREADSHEET_ID');
}

function cacheGetJson_(key) {
  try {
    const value = CacheService.getScriptCache().get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    return null;
  }
}

function cachePutJson_(key, value, ttlSeconds) {
  try {
    const json = JSON.stringify(value);
    if (json.length < 95000) {
      CacheService.getScriptCache().put(key, json, ttlSeconds || CACHE_TTL_SECONDS);
    }
  } catch (err) {
    console.warn('Cache ignorado: ' + safeErrorMessage_(err));
  }
}

function getAttendanceVersion_() {
  try {
    return CacheService.getScriptCache().get(CACHE_KEY_ATTENDANCE_VERSION) || '0';
  } catch (err) {
    return '0';
  }
}

function touchAttendanceVersion_() {
  try {
    CacheService.getScriptCache().put(
      CACHE_KEY_ATTENDANCE_VERSION,
      String(new Date().getTime()),
      21600
    );
  } catch (err) {}
}

function limparCaches_() {
  CacheService.getScriptCache().removeAll([
    CACHE_KEY_ROSTER,
    CACHE_KEY_SECTORS,
    CACHE_KEY_ATTENDANCE_VERSION
  ]);
}

function isAdminRequest_(params) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!expected) return false;
  const received = String((params && (params.token || params.adminToken)) || '');
  return received && received === expected;
}

/***********************
 * HELPERS
 ***********************/
function tz_() {
  return Session.getScriptTimeZone() || DEFAULT_TZ;
}

function normalizeDateCell_(value, tz) {
  const zone = tz || tz_();
  if (value instanceof Date) return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  const text = String(value || '').trim();
  return text ? text.slice(0, 10) : '';
}

function isValidIsoDate_(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  const date = toDateObjFromIso_(iso);
  return !!date && Utilities.formatDate(date, DEFAULT_TZ, 'yyyy-MM-dd') === iso;
}

function normalizeProjectKey_(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText_(value, maxLen) {
  let text = String(value || '').trim().replace(/\s+/g, ' ');
  if (maxLen && text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

function isWeekdayDate_(dateObj) {
  const day = dateObj.getDay();
  return day >= 1 && day <= 5;
}

function toDateObjFromIso_(iso) {
  const parts = String(iso || '').split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) {
    return null;
  }
  return date;
}

function canonicalProjectName_(projectInput) {
  const key = normalizeProjectKey_(projectInput);
  for (let i = 0; i < VALID_PROJECTS.length; i++) {
    if (normalizeProjectKey_(VALID_PROJECTS[i]) === key) return VALID_PROJECTS[i];
  }
  return normalizeText_(projectInput, 120);
}

function fallbackPhotoFromName_(name) {
  const clean = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return '';
  const parts = clean.split(' ').filter(Boolean);
  if (!parts.length) return '';
  return 'img/' + parts[0] + parts[parts.length - 1] + '.png';
}

function safeErrorMessage_(err) {
  return normalizeText_(err && err.message ? err.message : String(err || 'Erro interno.'), 500);
}

/***********************
 * ROSTER E SETORES
 ***********************/
function lerResponsaveisSetores_() {
  const cached = cacheGetJson_(CACHE_KEY_SECTORS);
  if (cached) return cached;

  const out = {};
  const sheet = getSourceSpreadsheet_().getSheetByName(SOURCE_SECTORS_SHEET_NAME);
  if (!sheet) return out;

  const lastRow = sheet.getLastRow();
  if (lastRow < SECTORS_FIRST_DATA_ROW) return out;

  const numRows = lastRow - SECTORS_FIRST_DATA_ROW + 1;
  const values = sheet.getRange(SECTORS_FIRST_DATA_ROW, SECTORS_COL_PROJECT, numRows, 2).getDisplayValues();

  values.forEach(function (row) {
    const projectRaw = normalizeText_(row[0], 120);
    if (!projectRaw) return;

    const project = canonicalProjectName_(projectRaw);
    out[normalizeProjectKey_(project)] = {
      project: project,
      responsavel: normalizeText_(row[1], 120)
    };
  });

  cachePutJson_(CACHE_KEY_SECTORS, out);
  return out;
}

function getResponsavelByProjeto_(project, map) {
  const item = (map || lerResponsaveisSetores_())[normalizeProjectKey_(project)];
  return item && item.responsavel ? item.responsavel : '';
}

function lerRosterDaOrigem_() {
  const cached = cacheGetJson_(CACHE_KEY_ROSTER);
  if (cached) return cached;

  const sheet = getSourceSpreadsheet_().getSheetByName(SOURCE_ROSTER_SHEET_NAME);
  if (!sheet) throw new Error('Aba de origem não encontrada: ' + SOURCE_ROSTER_SHEET_NAME);

  const lastRow = sheet.getLastRow();
  if (lastRow < SOURCE_FIRST_DATA_ROW) return [];

  const numRows = lastRow - SOURCE_FIRST_DATA_ROW + 1;
  const width = SOURCE_COL_PROJECT - SOURCE_COL_STUDENT + 1;
  const values = sheet.getRange(SOURCE_FIRST_DATA_ROW, SOURCE_COL_STUDENT, numRows, width).getDisplayValues();
  const photoIndex = SOURCE_COL_PHOTO - SOURCE_COL_STUDENT;
  const projectIndex = SOURCE_COL_PROJECT - SOURCE_COL_STUDENT;
  const out = [];

  values.forEach(function (row) {
    const student = normalizeText_(row[0], 120);
    const projectRaw = normalizeText_(row[projectIndex], 120);
    if (!student || !projectRaw) return;

    out.push({
      student: student,
      photo: normalizeText_(row[photoIndex], 500) || fallbackPhotoFromName_(student),
      project: canonicalProjectName_(projectRaw),
      projectKey: normalizeProjectKey_(projectRaw)
    });
  });

  cachePutJson_(CACHE_KEY_ROSTER, out);
  return out;
}

function rosterProjeto_(params) {
  const project = canonicalProjectName_(params.projeto || params.project || '');
  const key = normalizeProjectKey_(project);
  if (!key) return respond_({ status: 'error', message: 'Projeto obrigatório.' });

  const sectors = lerResponsaveisSetores_();
  const students = lerRosterDaOrigem_()
    .filter(function (item) { return item.projectKey === key; })
    .sort(function (a, b) { return a.student.localeCompare(b.student, 'pt-BR'); })
    .map(function (item) { return { nome: item.student, foto: item.photo || '' }; });

  return respond_({
    status: 'success',
    project: project,
    responsavel: getResponsavelByProjeto_(project, sectors),
    total: students.length,
    students: students
  });
}

function listaProjetosData_(sectors) {
  const map = sectors || lerResponsaveisSetores_();
  return VALID_PROJECTS.map(function (name) {
    return { projeto: name, responsavel: getResponsavelByProjeto_(name, map) };
  });
}

function listaProjetos_() {
  return respond_({ status: 'success', projects: listaProjetosData_() });
}

/***********************
 * REGISTRO MANUAL
 ***********************/
function registrar_(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return respond_({ status: 'error', message: 'O sistema está concluindo outro envio. Tente novamente.' });
  }

  try {
    ensureSheets_();

    const zone = tz_();
    const timestamp = new Date();
    const date = normalizeDateCell_(data.data || Utilities.formatDate(timestamp, zone, 'yyyy-MM-dd'), zone);
    const project = canonicalProjectName_(data.grupo || data.group || data.projeto || data.project || '');

    if (!isValidIsoDate_(date)) return respond_({ status: 'error', message: 'Data inválida.' });
    if (!normalizeProjectKey_(project)) return respond_({ status: 'error', message: 'Projeto obrigatório.' });

    let responsible = normalizeText_(data.responsavel || data.responsible || '', 120);
    if (!responsible) responsible = getResponsavelByProjeto_(project);

    const students = Array.isArray(data.alunos) ? data.alunos.map(function (item) {
      const observation = normalizeText_(item && (item.observacao || item.obs || ''), 500);
      return {
        name: normalizeText_(item && item.nome, 120),
        present: item && (item.presente === 1 || item.presente === true) ? 1 : 0,
        observationEnabled: item && (item.obsAtivo === 1 || item.obsAtivo === true || observation) ? 1 : 0,
        observation: observation
      };
    }).filter(function (item) { return item.name; }) : [];

    if (!students.length) return respond_({ status: 'error', message: 'Nenhum aluno no payload.' });

    const sheet = getAttendanceSpreadsheet_().getSheetByName(ATTENDANCE_SHEET_NAME);
    const lastRow = sheet.getLastRow();
    const rowsToDelete = [];

    if (lastRow >= 2) {
      const values = sheet.getRange(2, 2, lastRow - 1, 2).getValues();
      const projectKey = normalizeProjectKey_(project);
      for (let i = 0; i < values.length; i++) {
        if (
          normalizeDateCell_(values[i][0], zone) === date &&
          normalizeProjectKey_(canonicalProjectName_(values[i][1])) === projectKey
        ) {
          rowsToDelete.push(i + 2);
        }
      }
    }

    deleteRowsInRuns_(sheet, rowsToDelete);

    const rows = students.map(function (student) {
      return [
        timestamp,
        date,
        project,
        responsible,
        student.name,
        student.present,
        student.observationEnabled,
        student.observationEnabled ? student.observation : '',
        'MANUAL'
      ];
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ATTENDANCE_COLUMNS).setValues(rows);
    touchAttendanceVersion_();

    return respond_({
      status: 'success',
      added: rows.length,
      replaced: rowsToDelete.length,
      date: date,
      project: project,
      responsavel: responsible || ''
    });
  } finally {
    lock.releaseLock();
  }
}

function deleteRowsInRuns_(sheet, rowNumbers) {
  if (!rowNumbers.length) return;

  const runs = [];
  let start = rowNumbers[0];
  let previous = rowNumbers[0];

  for (let i = 1; i < rowNumbers.length; i++) {
    const current = rowNumbers[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    runs.push({ start: start, count: previous - start + 1 });
    start = current;
    previous = current;
  }
  runs.push({ start: start, count: previous - start + 1 });

  for (let i = runs.length - 1; i >= 0; i--) {
    sheet.deleteRows(runs[i].start, runs[i].count);
  }
}

/***********************
 * PRESENCA AUTOMATICA
 ***********************/
function processarPresencaAutomaticaHoje_() {
  ensureSheets_();

  const zone = tz_();
  const now = new Date();
  const today = Utilities.formatDate(now, zone, 'yyyy-MM-dd');
  const localDate = toDateObjFromIso_(today);

  if (!localDate || !isWeekdayDate_(localDate)) {
    return { message: 'Hoje não é dia útil.', date: today, inserted: 0, skippedProjects: 0 };
  }

  const byProject = {};
  lerRosterDaOrigem_().forEach(function (item) {
    if (!byProject[item.project]) byProject[item.project] = [];
    byProject[item.project].push(item.student);
  });

  const sectors = lerResponsaveisSetores_();
  const sheet = getAttendanceSpreadsheet_().getSheetByName(ATTENDANCE_SHEET_NAME);
  const existingToday = {};
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 2, lastRow - 1, 2).getValues();
    values.forEach(function (row) {
      if (normalizeDateCell_(row[0], zone) === today) {
        existingToday[normalizeProjectKey_(canonicalProjectName_(row[1]))] = true;
      }
    });
  }

  let skippedProjects = 0;
  const rows = [];

  Object.keys(byProject).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).forEach(function (project) {
    const key = normalizeProjectKey_(project);
    if (existingToday[key]) {
      skippedProjects++;
      return;
    }

    const responsible = getResponsavelByProjeto_(project, sectors);
    byProject[project].forEach(function (name) {
      rows.push([now, today, project, responsible, name, 1, 0, '', 'AUTO']);
    });
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ATTENDANCE_COLUMNS).setValues(rows);
    touchAttendanceVersion_();
  }

  return {
    message: 'Presença automática processada.',
    date: today,
    inserted: rows.length,
    skippedProjects: skippedProjects
  };
}

function instalarTriggerPresencaAutomatica_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processarPresencaAutomaticaHoje_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('processarPresencaAutomaticaHoje_')
    .timeBased()
    .everyDays(1)
    .atHour(18)
    .create();
}

/***********************
 * DASHBOARD
 ***********************/
function consultarDashboard_(params) {
  const zone = tz_();
  const today = Utilities.formatDate(new Date(), zone, 'yyyy-MM-dd');
  const start = normalizeDateCell_(params.start || params.inicio || today, zone);
  const end = normalizeDateCell_(params.end || params.fim || today, zone);
  const filterProject = canonicalProjectName_(params.projeto || params.group || params.project || '');
  const filterKey = normalizeProjectKey_(filterProject);
  const includeRows = String(params.rows || '1') !== '0';
  const absencesOnly = String(params.faltas || params.absences || '0') === '1';
  const requestedLimit = Number(params.limit || 0);
  const rowLimit = requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 2000) : 0;

  if (!isValidIsoDate_(start) || !isValidIsoDate_(end) || start > end) {
    return respond_({ status: 'error', message: 'Período inválido.' });
  }

  const cacheKey = [
    'dashboard:v2', getAttendanceVersion_(), start, end, filterKey,
    includeRows ? '1' : '0', absencesOnly ? '1' : '0', rowLimit
  ].join(':');
  const cached = cacheGetJson_(cacheKey);
  if (cached) return respond_(cached);

  const sheet = getAttendanceSpreadsheet_().getSheetByName(ATTENDANCE_SHEET_NAME);
  if (!sheet) return respond_({ status: 'error', message: 'Aba Attendance não encontrada.' });

  const rowsOut = [];
  const observations = [];
  const summaryMap = {};
  let total = 0;
  let presentCount = 0;
  let absenceCount = 0;
  let observationCount = 0;
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 2, lastRow - 1, 8).getValues();

    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];
      const dateIso = normalizeDateCell_(row[0], zone);
      const project = canonicalProjectName_(row[1]);
      const projectKey = normalizeProjectKey_(project);

      if (!dateIso || dateIso < start || dateIso > end) continue;
      if (filterKey && projectKey !== filterKey) continue;

      const item = {
        date: dateIso,
        group: project,
        responsible: normalizeText_(row[2], 120),
        student: normalizeText_(row[3], 120),
        present: Number(row[4]) === 1 ? 1 : 0,
        observation: normalizeText_(row[6], 500),
        source: normalizeText_(row[7], 30) || 'MANUAL'
      };
      const obsEnabled = Number(row[5]) === 1;

      total++;
      if (item.present) presentCount++;
      else absenceCount++;
      if (obsEnabled || item.observation) observationCount++;

      if (!summaryMap[project]) {
        summaryMap[project] = { group: project, total: 0, presentes: 0, faltas: 0, observacoes: 0 };
      }
      const summary = summaryMap[project];
      summary.total++;
      if (item.present) summary.presentes++;
      else summary.faltas++;
      if (obsEnabled || item.observation) summary.observacoes++;

      if (item.observation && observations.length < 300) observations.push(item);
      if (
        includeRows &&
        (!absencesOnly || !item.present) &&
        (!rowLimit || rowsOut.length < rowLimit)
      ) {
        rowsOut.push(item);
      }
    }
  }

  const summaryByGroup = Object.keys(summaryMap).map(function (key) {
    const item = summaryMap[key];
    item.frequenciaPct = item.total ? Number(((item.presentes / item.total) * 100).toFixed(1)) : 0;
    return item;
  }).sort(function (a, b) { return a.group.localeCompare(b.group, 'pt-BR'); });

  const result = {
    status: 'success',
    filter: { start: start, end: end, projeto: filterKey ? filterProject : null },
    metrics: {
      totalLancamentos: total,
      presentes: presentCount,
      faltas: absenceCount,
      observacoes: observationCount,
      frequenciaPct: total ? Number(((presentCount / total) * 100).toFixed(1)) : 0
    },
    resumoPorGrupo: summaryByGroup,
    observacoes: observations,
    rows: includeRows ? rowsOut : []
  };

  cachePutJson_(cacheKey, result, DASHBOARD_CACHE_TTL_SECONDS);
  return respond_(result);
}

/***********************
 * SETUP
 ***********************/
function ensureSheets_() {
  const spreadsheet = getAttendanceSpreadsheet_();
  const header = ['Timestamp', 'Date', 'Group', 'Responsible', 'Student', 'Present', 'ObsEnabled', 'Observation', 'Source'];
  let attendance = spreadsheet.getSheetByName(ATTENDANCE_SHEET_NAME);

  if (!attendance) {
    attendance = spreadsheet.insertSheet(ATTENDANCE_SHEET_NAME);
    attendance.getRange(1, 1, 1, header.length).setValues([header]);
    attendance.setFrozenRows(1);
  } else if (attendance.getLastRow() === 0) {
    attendance.getRange(1, 1, 1, header.length).setValues([header]);
    attendance.setFrozenRows(1);
  } else {
    const first = attendance.getRange(1, 1, 1, Math.max(attendance.getLastColumn(), 1)).getDisplayValues()[0];
    const same = header.every(function (item, index) { return String(first[index] || '') === item; });
    if (!same) {
      const oldHeader = ['Timestamp', 'Date', 'Group', 'Responsible', 'Student', 'Present'];
      const old = oldHeader.every(function (item, index) { return String(first[index] || '') === item; });
      if (old) {
        attendance.getRange(1, 1, 1, header.length).setValues([header]);
        const rows = attendance.getLastRow() - 1;
        if (rows > 0) {
          attendance.getRange(2, 7, rows, 3).setValues(Array.from({ length: rows }, function () {
            return [0, '', 'LEGACY'];
          }));
        }
      } else {
        throw new Error('Cabeçalho inesperado na aba ' + ATTENDANCE_SHEET_NAME + '.');
      }
    }
  }

  let groups = spreadsheet.getSheetByName(GROUPS_SHEET_NAME);
  if (!groups) {
    groups = spreadsheet.insertSheet(GROUPS_SHEET_NAME);
    const rows = [['Group', 'Responsible', 'PhotoURL']].concat(VALID_PROJECTS.map(function (project) {
      return [project, '', ''];
    }));
    groups.getRange(1, 1, rows.length, 3).setValues(rows);
    groups.setFrozenRows(1);
  } else if (groups.getLastRow() === 0) {
    groups.getRange(1, 1, 1, 3).setValues([['Group', 'Responsible', 'PhotoURL']]);
    groups.setFrozenRows(1);
  }
}

function configurarProjeto_() {
  ensureSheets_();
  limparCaches_();
  console.log('Projeto configurado. Versão ' + APP_VERSION);
}

function respond_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
