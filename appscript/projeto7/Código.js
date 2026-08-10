/**
 * Setup completo: cria abas + colunas (headers) automaticamente.
 * Como usar:
 * 1) Abra sua Planilha Google
 * 2) Extensões → Apps Script
 * 3) Cole este arquivo (Code.gs), salve
 * 4) Execute setupScholarshipSystem()
 *
 * Observação:
 * - Se a aba já existir, ele garante que o header esteja correto (regrava a linha 1).
 * - Não apaga seus dados; só reescreve a primeira linha (header).
 */

function setupScholarshipSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const SCHEMA = [
    {
      name: "STUDENTS",
      headers: [
        "student_id",
        "name",
        "sex",
        "birth_date",
        "age",
        "phone_e164",
        "phone_display",
        "whatsapp_link",
        "photo_url",
        "scholarship_type_id",
        "scholarship_type_name",
        "sector_current_id",
        "sector_current_name",
        "workload_minutes",
        "status",
        "notes",
        "created_at",
        "updated_at"
      ],
      widths: {
        1: 140, 2: 240, 3: 80, 4: 120, 5: 60, 6: 140, 7: 140, 8: 220, 9: 220,
        10: 140, 11: 180, 12: 140, 13: 180, 14: 140, 15: 100, 16: 260, 17: 150, 18: 150
      },
      freezeRows: 1,
      filter: true
    },
    {
      name: "SECTORS",
      headers: [
        "sector_id",
        "name",
        "description",
        "active",
        "created_at",
        "updated_at"
      ],
      widths: { 1: 140, 2: 220, 3: 340, 4: 80, 5: 150, 6: 150 },
      freezeRows: 1,
      filter: true
    },
    {
      name: "SCHOLARSHIP_TYPES",
      headers: [
        "type_id",
        "name",
        "description",
        "active",
        "created_at",
        "updated_at"
      ],
      widths: { 1: 140, 2: 220, 3: 340, 4: 80, 5: 150, 6: 150 },
      freezeRows: 1,
      filter: true
    },
    {
      name: "COMPETENCIES",
      headers: [
        "comp_id",
        "name",
        "description",
        "weight",
        "active",
        "created_at",
        "updated_at"
      ],
      widths: { 1: 140, 2: 220, 3: 360, 4: 80, 5: 80, 6: 150, 7: 150 },
      freezeRows: 1,
      filter: true
    },
    {
      name: "EVALUATIONS",
      headers: [
        "eval_id",
        "student_id",
        "student_name",
        "date",
        "period_tag",
        "evaluator",
        "scores_json",
        "scores_avg_0_10",
        "auto_summary",
        "written_report",
        "created_at",
        "updated_at"
      ],
      widths: { 1: 140, 2: 140, 3: 220, 4: 120, 5: 120, 6: 160, 7: 260, 8: 130, 9: 360, 10: 360, 11: 150, 12: 150 },
      freezeRows: 1,
      filter: true
    },
    {
      name: "USERS",
      headers: [
        "user_id",
        "login",
        "password_hash",
        "role",
        "active",
        "last_login_at",
        "created_at",
        "updated_at"
      ],
      widths: { 1: 140, 2: 200, 3: 260, 4: 100, 5: 80, 6: 150, 7: 150, 8: 150 },
      freezeRows: 1,
      filter: true
    },
    {
      name: "SESSIONS",
      headers: [
        "session_token",
        "user_id",
        "role",
        "issued_at",
        "expires_at",
        "revoked",
        "ip",
        "user_agent"
      ],
      widths: { 1: 220, 2: 140, 3: 100, 4: 150, 5: 150, 6: 90, 7: 140, 8: 260 },
      freezeRows: 1,
      filter: true
    },
    {
      name: "SETTINGS",
      headers: [
        "key",
        "value",
        "description",
        "updated_at"
      ],
      widths: { 1: 220, 2: 320, 3: 360, 4: 150 },
      freezeRows: 1,
      filter: false
    }
  ];

  // Cria/atualiza abas
  SCHEMA.forEach(def => {
    const sheet = getOrCreateSheet_(ss, def.name);
    applyHeader_(sheet, def.headers);
    applyBasicStyle_(sheet, def);
  });

  // Preenche SETTINGS com defaults úteis (não sobrescreve se já existir)
  seedSettings_(ss);

  // Adiciona validações simples (status/active/role/sex) sem travar seu fluxo
  applyValidations_(ss);

  SpreadsheetApp.flush();
}

/* ========================= Helpers ========================= */

function getOrCreateSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function applyHeader_(sheet, headers) {
  // garante pelo menos 1 linha
  if (sheet.getMaxRows() < 1) sheet.insertRowBefore(1);

  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);

  // Limpa colunas excedentes no header (se o sheet tinha mais colunas usadas)
  const maxCols = sheet.getMaxColumns();
  if (maxCols > headers.length) {
    // não remove colunas automaticamente (pode ter dados); apenas deixa o header correto
  }
}

function applyBasicStyle_(sheet, def) {
  const lastCol = def.headers.length;

  // freeze
  sheet.setFrozenRows(def.freezeRows || 0);

  // auto filter
  if (def.filter) {
    const filterRange = sheet.getRange(1, 1, 1, lastCol);
    const existingFilter = sheet.getFilter();
    if (existingFilter) existingFilter.remove();
    filterRange.createFilter();
  }

  // header style
  const header = sheet.getRange(1, 1, 1, lastCol);
  header
    .setFontWeight("bold")
    .setBackground("#0b1f3a") // navy
    .setFontColor("#ffffff")
    .setWrap(true)
    .setVerticalAlignment("middle");

  sheet.setRowHeight(1, 36);

  // column widths
  if (def.widths) {
    Object.keys(def.widths).forEach(k => {
      const col = Number(k);
      const w = def.widths[k];
      sheet.setColumnWidth(col, w);
    });
  }

  // basic formatting for entire sheet
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), lastCol)
    .setVerticalAlignment("middle")
    .setWrap(true);

  // set default number/date formats for common columns by name (best-effort)
  const headerValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIndex = name => headerValues.indexOf(name) + 1;

  const birthCol = colIndex("birth_date");
  if (birthCol > 0) sheet.getRange(2, birthCol, sheet.getMaxRows() - 1).setNumberFormat("yyyy-mm-dd");

  const dateCol = colIndex("date");
  if (dateCol > 0) sheet.getRange(2, dateCol, sheet.getMaxRows() - 1).setNumberFormat("yyyy-mm-dd");

  const createdCol = colIndex("created_at");
  if (createdCol > 0) sheet.getRange(2, createdCol, sheet.getMaxRows() - 1).setNumberFormat("yyyy-mm-dd hh:mm");

  const updatedCol = colIndex("updated_at");
  if (updatedCol > 0) sheet.getRange(2, updatedCol, sheet.getMaxRows() - 1).setNumberFormat("yyyy-mm-dd hh:mm");
}

function seedSettings_(ss) {
  const sh = ss.getSheetByName("SETTINGS");
  if (!sh) return;

  const lastRow = sh.getLastRow(); // >= 1 (header)
  let existing = [];
  if (lastRow >= 2) {
    existing = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat().filter(String);
  }
  const existingSet = new Set(existing);

  const defaults = [
    ["ORG_NAME", "Sua Escola", "Nome exibido no sistema", nowIso_()],
    ["DEFAULT_COUNTRY_CODE", "55", "Código do país para WhatsApp (Brasil = 55)", nowIso_()],
    ["SESSION_DAYS", "7", "Dias para expiração de sessão", nowIso_()],
    ["NORM_SCORE_MAX", "10", "Nota máxima por competência", nowIso_()],
    ["NORM_SCORE_TO_PERCENT", "10", "Multiplicador para converter 0-10 em 0-100 (10 = x10)", nowIso_()],
    ["PASSWORD_SALT", "change-me", "Salt para hash de senha (trocar automaticamente no seedFirstEditor)", nowIso_()]
  ];

  const toAppend = defaults.filter(row => !existingSet.has(row[0]));
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, 4).setValues(toAppend);
  }
}


function applyValidations_(ss) {
  // Validações simples e não intrusivas
  const students = ss.getSheetByName("STUDENTS");
  const sectors = ss.getSheetByName("SECTORS");
  const types = ss.getSheetByName("SCHOLARSHIP_TYPES");
  const users = ss.getSheetByName("USERS");
  const comp = ss.getSheetByName("COMPETENCIES");

  if (students) {
    setValidationByHeader_(students, "sex", ["M", "F"]);
    setValidationByHeader_(students, "status", ["ACTIVE", "INACTIVE"]);
    // workload_minutes: valores típicos 90 ou 120, mas deixa aberto sem validação rígida
  }

  if (sectors) {
    setValidationByHeader_(sectors, "active", ["TRUE", "FALSE"]);
  }

  if (types) {
    setValidationByHeader_(types, "active", ["TRUE", "FALSE"]);
  }

  if (comp) {
    setValidationByHeader_(comp, "active", ["TRUE", "FALSE"]);
  }

  if (users) {
    setValidationByHeader_(users, "role", ["EDITOR", "VIEWER"]);
    setValidationByHeader_(users, "active", ["TRUE", "FALSE"]);
  }
}

function setValidationByHeader_(sheet, headerName, allowed) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = headers.indexOf(headerName);
  if (idx === -1) return;

  const col = idx + 1;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(allowed, true)
    .setAllowInvalid(true)
    .build();

  const rows = sheet.getMaxRows() - 1;
  if (rows < 1) return; // evita range com 0 linhas

  sheet.getRange(2, col, rows, 1).setDataValidation(rule);
}


function nowIso_() {
  const d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}
