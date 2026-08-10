/* =========================
 * API (Web App) - Api.gs (FULL)
 * =========================
 * Roteamento por action:
 * - ping
 * - login, logout, me
 *
 * VIEWER/EDITOR (relatórios e consultas):
 * - listStudents
 * - listSectors
 * - listScholarshipTypes
 * - listCompetencies
 * - listEvaluationsByStudent
 * - getStudentReport
 *
 * Somente EDITOR (cadastros/edições):
 * - upsertStudent, deactivateStudent, setStudentSector
 * - upsertSector
 * - upsertScholarshipType
 * - upsertCompetency
 * - createEvaluation
 * - createUser
 * - changePassword
 *
 * Segurança:
 * - login -> session_token (tabela SESSIONS)
 * - demais actions exigem token via:
 *   - Header Authorization: Bearer <token> (se vier)
 *   - OU body/query: token=<token> (fallback confiável)
 *
 * Requisitos:
 * - Rodar setupScholarshipSystem() do Code.gs antes.
 */

const PROFILE_API_VERSION = "2.2.0";
const PROFILE_CACHE_PREFIX = "profile-api:v2:";
const PROFILE_CACHEABLE_SHEETS = Object.freeze({
  SECTORS: 600,
  SCHOLARSHIP_TYPES: 600,
  COMPETENCIES: 600,
  SETTINGS: 300
});

const _sheetRuntimeCache = {};
const _rowsRuntimeCache = {};
const _headersRuntimeCache = {};

function doOptions(e) {
  return _corsTextOutput_("");
}

function doGet(e) {
  return _handleRequest_(e, "GET");
}

function doPost(e) {
  return _handleRequest_(e, "POST");
}

/* ========================= Router ========================= */

function _handleRequest_(e, method) {
  try {
    const req = _parseRequest_(e, method);
    const action = (req.action || "").trim();

    if (!action) return _error_("Missing action", 400);

    // Ações públicas
    if (action === "ping") return _corsJsonOutput_({ ok: true, now: _nowIso_(), version: PROFILE_API_VERSION });
    if (action === "login") return _corsJsonOutput_(_login_(req));

    // Demais ações exigem autenticação
    const auth = _requireAuth_(req);
    const ctx = auth.ctx;

    switch (action) {
      case "logout":
        return _corsJsonOutput_(_logout_(req, ctx));

      case "me":
        return _corsJsonOutput_({ ok: true, user: { user_id: ctx.user.user_id, login: ctx.user.login, role: ctx.user.role } });

      /* ===== Relatórios / Consultas (VIEWER + EDITOR) ===== */

      case "listStudents":
        return _corsJsonOutput_(_listStudents_(req, ctx));

      case "listSectors":
        return _corsJsonOutput_(_listSectors_(req, ctx));

      case "listScholarshipTypes":
        return _corsJsonOutput_(_listScholarshipTypes_(req, ctx));

      case "listCompetencies":
        return _corsJsonOutput_(_listCompetencies_(req, ctx));

      case "listEvaluationsByStudent":
        return _corsJsonOutput_(_listEvaluationsByStudent_(req, ctx));

      case "getStudentReport":
        return _corsJsonOutput_(_getStudentReport_(req, ctx));

      case "getSponsorReport":
        return _corsJsonOutput_(_getSponsorReport_(req, ctx));

      case "getHomeOverview":
        return _corsJsonOutput_(_getHomeOverview_(req, ctx));

      case "getStudentDirectory":
        return _corsJsonOutput_(_getStudentDirectory_(req, ctx));

      case "getEditorBootstrap":
        return _corsJsonOutput_(_getEditorBootstrap_(req, ctx));

      case "getStudentProfile":
        return _corsJsonOutput_(_getStudentProfile_(req, ctx));

      /* ===== Cadastros / Edições (somente EDITOR) ===== */

      case "upsertStudent":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_upsertStudent_(req, ctx));

      case "deactivateStudent":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_deactivateStudent_(req, ctx));

      case "setStudentSector":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_setStudentSector_(req, ctx));

      case "upsertSector":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_upsertSector_(req, ctx));

      case "upsertScholarshipType":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_upsertScholarshipType_(req, ctx));

      case "upsertCompetency":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_upsertCompetency_(req, ctx));

      case "createEvaluation":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_createEvaluation_(req, ctx));

      /* ===== Admin de usuários (somente EDITOR) ===== */

      case "createUser":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_createUser_(req, ctx));

      case "changePassword":
        _requireRole_(ctx, ["EDITOR"]);
        return _corsJsonOutput_(_changePassword_(req, ctx));

      default:
        return _error_("Unknown action: " + action, 400);
    }
  } catch (err) {
    return _error_(String(err && err.message ? err.message : err), 500);
  }
}

/* ========================= Request parsing ========================= */

function _parseRequest_(e, method) {
  const query = (e && e.parameter) ? e.parameter : {};
  let body = {};

  if (method === "POST" && e && e.postData && e.postData.contents) {
    const ct = (e.postData.type || "").toLowerCase();
    const raw = e.postData.contents;

    if (ct.indexOf("application/json") !== -1) {
      body = JSON.parse(raw || "{}");
    } else {
      try { body = JSON.parse(raw || "{}"); } catch (_) { body = {}; }
    }
  }

  const req = {};
  Object.keys(query).forEach(k => req[k] = query[k]);
  Object.keys(body).forEach(k => req[k] = body[k]);

  req._headers = (e && e.headers) ? e.headers : {};
  return req;
}

/* ========================= Auth / Sessions ========================= */

function _requireAuth_(req) {
  const token = _getTokenFromReq_(req);
  if (!token) throw new Error("Missing session token");

  const sess = _getSessionByToken_(token);
  if (!sess) throw new Error("Invalid session token");
  if (sess.revoked === "TRUE") throw new Error("Session revoked");
  if (new Date(sess.expires_at).getTime() < Date.now()) throw new Error("Session expired");

  const user = _getUserById_(sess.user_id);
  if (!user) throw new Error("User not found");
  if (String(user.active || "").toUpperCase() !== "TRUE") throw new Error("User inactive");


  return { ok: true, ctx: { token: token, session: sess, user: user } };
}

function _requireRole_(ctx, roles) {
  if (roles.indexOf(ctx.user.role) === -1) {
    throw new Error("Forbidden: role " + ctx.user.role);
  }
}

function _getTokenFromReq_(req) {
  const headers = req._headers || {};
  const auth = headers.Authorization || headers.authorization || "";
  if (auth && typeof auth === "string" && auth.toLowerCase().indexOf("bearer ") === 0) {
    return auth.substring(7).trim();
  }
  return (req.token || "").trim();
}

function _login_(req) {
  const login = (req.login || "").trim();
  const password = String(req.password || "");

  if (!login || !password) return { ok: false, error: "Missing login/password" };

  const user = _getUserByLogin_(login);
  if (!user) return { ok: false, error: "Invalid credentials" };
  if (String(user.active || "").toUpperCase() !== "TRUE") return { ok: false, error: "User inactive" };


  const salt = _getSetting_("PASSWORD_SALT", "change-me");
  const computed = _sha256Base64_(salt + ":" + password);
  if (computed !== user.password_hash) return { ok: false, error: "Invalid credentials" };

  const sessionDays = Number(_getSetting_("SESSION_DAYS", "7")) || 7;
  const issued = new Date();
  const expires = new Date(issued.getTime() + sessionDays * 24 * 60 * 60 * 1000);

  const token = _randToken_();
  _appendRow_("SESSIONS", [
    token,
    user.user_id,
    user.role,
    _formatDateTime_(issued),
    _formatDateTime_(expires),
    "FALSE",
    String(req.ip || ""),
    String(req.user_agent || "")
  ]);

  _updateUserLastLogin_(user.user_id);

  return {
    ok: true,
    token: token,
    user: { user_id: user.user_id, login: user.login, role: user.role },
    expires_at: _formatDateTime_(expires)
  };
}

function _logout_(req, ctx) {
  _revokeSession_(ctx.token);
  return { ok: true };
}

/* ========================= CRUD: Students ========================= */

function _listStudents_(req, ctx) {
  const filters = req.filters || {};
  const rows = _getAll_("STUDENTS");

  let out = rows;

  const status = (filters.status || req.status || "").trim();
  if (status) out = out.filter(r => (r.status || "") === status);

  const sex = (filters.sex || req.sex || "").trim();
  if (sex) out = out.filter(r => (r.sex || "") === sex);

  const sectorId = (filters.sector_id || req.sector_id || "").trim();
  if (sectorId) out = out.filter(r => (r.sector_current_id || "") === sectorId);

  const typeId = (filters.scholarship_type_id || req.scholarship_type_id || "").trim();
  if (typeId) out = out.filter(r => (r.scholarship_type_id || "") === typeId);

  const q = String(filters.q || req.q || "").trim().toLowerCase();
  if (q) {
    out = out.filter(r =>
      String(r.name || "").toLowerCase().indexOf(q) !== -1 ||
      String(r.phone_display || "").toLowerCase().indexOf(q) !== -1
    );
  }

  const ageMinRaw = filters.age_min || req.age_min;
  const ageMaxRaw = filters.age_max || req.age_max;
  const ageMin = ageMinRaw === undefined || ageMinRaw === "" ? NaN : Number(ageMinRaw);
  const ageMax = ageMaxRaw === undefined || ageMaxRaw === "" ? NaN : Number(ageMaxRaw);

  if (!isNaN(ageMin)) out = out.filter(r => Number(r.age || "") >= ageMin);
  if (!isNaN(ageMax)) out = out.filter(r => Number(r.age || "") <= ageMax);

  return { ok: true, students: out, count: out.length };
}

function _getHomeOverview_(req, ctx) {
  const students = _getAll_("STUDENTS");
  const activeStudents = students.filter(r => String(r.status || "ACTIVE").toUpperCase() === "ACTIVE");
  const sectors = _getAll_("SECTORS");
  const scholarshipTypes = _getAll_("SCHOLARSHIP_TYPES");

  return {
    ok: true,
    version: PROFILE_API_VERSION,
    now: _nowIso_(),
    metrics: {
      active_students: activeStudents.length,
      sectors: sectors.length,
      scholarship_types: scholarshipTypes.length
    }
  };
}

function _getStudentDirectory_(req, ctx) {
  const studentsResult = _listStudents_(req, ctx);
  const includeMeta = String(req.include_meta || "TRUE").toUpperCase() !== "FALSE";

  return {
    ok: true,
    students: studentsResult.students,
    count: studentsResult.count,
    sectors: includeMeta ? _getAll_("SECTORS") : [],
    scholarship_types: includeMeta ? _getAll_("SCHOLARSHIP_TYPES") : []
  };
}

function _getEditorBootstrap_(req, ctx) {
  _requireRole_(ctx, ["EDITOR"]);
  const students = _listStudents_({ filters: {} }, ctx);
  return {
    ok: true,
    students: students.students,
    sectors: _getAll_("SECTORS"),
    scholarship_types: _getAll_("SCHOLARSHIP_TYPES"),
    competencies: _getAll_("COMPETENCIES")
  };
}

function _getStudentProfile_(req, ctx) {
  const report = _getStudentReport_(req, ctx);
  report.competencies = _getAll_("COMPETENCIES")
    .filter(c => String(c.active || "TRUE").toUpperCase().trim() === "TRUE");
  return report;
}

function _upsertStudent_(req, ctx) {
  const p = req.student || req;

  const studentId = String(p.student_id || "").trim() || _uuid_();
  const name = String(p.name || "").trim();
  if (!name) throw new Error("student.name is required");

  const sex = String(p.sex || "").trim();
  const birthDate = String(p.birth_date || "").trim();
  const age = birthDate ? _calcAge_(birthDate) : (String(p.age || "").trim() || "");
  const phone = String(p.phone_e164 || p.phone || "").trim();
  const phoneDisplay = String(p.phone_display || "").trim() || phone;
  const photoUrl = String(p.photo_url || "").trim();

  const scholarshipTypeId = String(p.scholarship_type_id || "").trim();
  const scholarshipTypeName = String(p.scholarship_type_name || "").trim();
  const sectorId = String(p.sector_current_id || "").trim();
  const sectorName = String(p.sector_current_name || "").trim();

  const workloadMinutes = String(p.workload_minutes || "").trim();
  const status = String(p.status || "ACTIVE").trim();
  const notes = String(p.notes || "").trim();

  const countryCode = String(_getSetting_("DEFAULT_COUNTRY_CODE", "55")).trim();
  const normalizedPhone = _normalizePhoneE164_(phone, countryCode);
  const waLink = normalizedPhone ? ("https://wa.me/" + normalizedPhone.replace("+", "")) : "";

  const now = _nowIso_();

  const sheet = _sheet_("STUDENTS");
  const idx = _findRowByKey_(sheet, "student_id", studentId);

  const rowObj = {
    student_id: studentId,
    name: name,
    sex: sex,
    birth_date: birthDate,
    age: age,
    phone_e164: normalizedPhone,
    phone_display: phoneDisplay,
    whatsapp_link: waLink,
    photo_url: photoUrl,
    scholarship_type_id: scholarshipTypeId,
    scholarship_type_name: scholarshipTypeName,
    sector_current_id: sectorId,
    sector_current_name: sectorName,
    workload_minutes: workloadMinutes,
    status: status,
    notes: notes,
    created_at: now,
    updated_at: now
  };

  if (idx.rowNumber === 0) {
    _appendObjectRow_(sheet, rowObj);
  } else {
    rowObj.created_at = idx.row.created_at || now;
    _updateObjectRow_(sheet, idx.rowNumber, rowObj);
  }

  return { ok: true, student_id: studentId };
}

function _deactivateStudent_(req, ctx) {
  const studentId = String(req.student_id || "").trim();
  if (!studentId) throw new Error("student_id required");

  const sheet = _sheet_("STUDENTS");
  const idx = _findRowByKey_(sheet, "student_id", studentId);
  if (idx.rowNumber === 0) throw new Error("Student not found");

  idx.row.status = "INACTIVE";
  idx.row.updated_at = _nowIso_();
  _updateObjectRow_(sheet, idx.rowNumber, idx.row);
  return { ok: true };
}

function _setStudentSector_(req, ctx) {
  const studentId = String(req.student_id || "").trim();
  const sectorId = String(req.sector_id || "").trim();
  const sectorName = String(req.sector_name || "").trim();

  if (!studentId) throw new Error("student_id is required");
  if (!sectorId) throw new Error("sector_id is required");

  const sh = _sheet_("STUDENTS");
  const idx = _findRowByKey_(sh, "student_id", studentId);
  if (!idx.rowNumber) throw new Error("Student not found");

  let finalSectorName = sectorName;
  if (!finalSectorName) {
    const secSh = _sheet_("SECTORS");
    const secIdx = _findRowByKey_(secSh, "sector_id", sectorId);
    finalSectorName = secIdx.rowNumber ? (secIdx.row.name || "") : "";
  }

  idx.row.sector_current_id = sectorId;
  idx.row.sector_current_name = finalSectorName;
  idx.row.updated_at = _nowIso_();

  _updateObjectRow_(sh, idx.rowNumber, idx.row);

  return { ok: true, student_id: studentId, sector_id: sectorId, sector_name: finalSectorName };
}

/* ========================= CRUD: Sectors ========================= */

function _listSectors_(req, ctx) {
  const rows = _getAll_("SECTORS");
  const activeOnly = String(req.active_only || "FALSE").toUpperCase() === "TRUE";
  const out = activeOnly ? rows.filter(r => String(r.active || "TRUE").toUpperCase().trim() === "TRUE") : rows;
  return { ok: true, sectors: out, count: out.length };
}

function _upsertSector_(req, ctx) {
  const p = req.sector || req;
  const sectorId = String(p.sector_id || "").trim() || _uuid_();
  const name = String(p.name || "").trim();
  if (!name) throw new Error("sector.name is required");

  const desc = String(p.description || "").trim();
  const active = String(p.active || "TRUE").toUpperCase() === "FALSE" ? "FALSE" : "TRUE";
  const now = _nowIso_();

  const sheet = _sheet_("SECTORS");
  const idx = _findRowByKey_(sheet, "sector_id", sectorId);

  const rowObj = {
    sector_id: sectorId,
    name: name,
    description: desc,
    active: active,
    created_at: now,
    updated_at: now
  };

  if (idx.rowNumber === 0) _appendObjectRow_(sheet, rowObj);
  else {
    rowObj.created_at = idx.row.created_at || now;
    _updateObjectRow_(sheet, idx.rowNumber, rowObj);
  }

  return { ok: true, sector_id: sectorId };
}

/* ========================= CRUD: Scholarship Types ========================= */

function _listScholarshipTypes_(req, ctx) {
  const rows = _getAll_("SCHOLARSHIP_TYPES");
  const activeOnly = String(req.active_only || "FALSE").toUpperCase() === "TRUE";
  const out = activeOnly ? rows.filter(r => String(r.active || "TRUE").toUpperCase().trim() === "TRUE") : rows;
  return { ok: true, scholarship_types: out, count: out.length };
}

function _upsertScholarshipType_(req, ctx) {
  const p = req.type || req.scholarship_type || req;
  const typeId = String(p.type_id || "").trim() || _uuid_();
  const name = String(p.name || "").trim();
  if (!name) throw new Error("type.name is required");

  const desc = String(p.description || "").trim();
  const active = String(p.active || "TRUE").toUpperCase() === "FALSE" ? "FALSE" : "TRUE";
  const now = _nowIso_();

  const sheet = _sheet_("SCHOLARSHIP_TYPES");
  const idx = _findRowByKey_(sheet, "type_id", typeId);

  const rowObj = {
    type_id: typeId,
    name: name,
    description: desc,
    active: active,
    created_at: now,
    updated_at: now
  };

  if (idx.rowNumber === 0) _appendObjectRow_(sheet, rowObj);
  else {
    rowObj.created_at = idx.row.created_at || now;
    _updateObjectRow_(sheet, idx.rowNumber, rowObj);
  }

  return { ok: true, type_id: typeId };
}

/* ========================= CRUD: Competencies ========================= */

function _listCompetencies_(req, ctx) {
  const rows = _getAll_("COMPETENCIES");
  const activeOnly = String(req.active_only || "FALSE").toUpperCase() === "TRUE";
  const out = activeOnly ? rows.filter(r => String(r.active || "TRUE").toUpperCase().trim() === "TRUE") : rows;
  return { ok: true, competencies: out, count: out.length };
}

function _upsertCompetency_(req, ctx) {
  const p = req.competency || req;
  const compId = String(p.comp_id || "").trim() || _uuid_();
  const name = String(p.name || "").trim();
  if (!name) throw new Error("competency.name is required");

  const desc = String(p.description || "").trim();
  const weight = String(p.weight || "1").trim();
  const active = String(p.active || "TRUE").toUpperCase() === "FALSE" ? "FALSE" : "TRUE";
  const now = _nowIso_();

  const sheet = _sheet_("COMPETENCIES");
  const idx = _findRowByKey_(sheet, "comp_id", compId);

  const rowObj = {
    comp_id: compId,
    name: name,
    description: desc,
    weight: weight,
    active: active,
    created_at: now,
    updated_at: now
  };

  if (idx.rowNumber === 0) _appendObjectRow_(sheet, rowObj);
  else {
    rowObj.created_at = idx.row.created_at || now;
    _updateObjectRow_(sheet, idx.rowNumber, rowObj);
  }

  return { ok: true, comp_id: compId };
}

/* ========================= Evaluations ========================= */

function _createEvaluation_(req, ctx) {
  const p = req.evaluation || req;

  const studentId = String(p.student_id || "").trim();
  if (!studentId) throw new Error("student_id is required");

  const st = _getStudentById_(studentId);
  if (!st) throw new Error("Student not found");

  const date = String(p.date || "").trim() || _today_();
  const periodTag = String(p.period_tag || "").trim();
  const evaluator = String(p.evaluator || ctx.user.login || "").trim();

  const scores = p.scores || {};
  if (!scores || typeof scores !== "object") throw new Error("scores must be an object");

  const compList = _getAll_("COMPETENCIES")
  .filter(c => String(c.active || "TRUE").toUpperCase().trim() === "TRUE");
  const compById = {};
  const compByNormName = {};
  compList.forEach(c => {
    compById[c.comp_id] = c;
    compByNormName[_norm_(c.name)] = c;
  });

  const scoreById = {};
  Object.keys(scores).forEach(k => {
    const v = Number(scores[k]);
    if (isNaN(v)) return;

    const key = String(k).trim();
    if (compById[key]) scoreById[key] = _clamp_(v, 0, 10);
    else {
      const c = compByNormName[_norm_(key)];
      if (c) scoreById[c.comp_id] = _clamp_(v, 0, 10);
    }
  });

  const avg = _avgScores_(scoreById);
  const autoSummary = _buildAutoSummary_(compList, scoreById);
  const writtenReport = String(p.written_report || "").trim();

  const evalId = String(p.eval_id || "").trim() || _uuid_();
  const now = _nowIso_();
  const scoresJson = JSON.stringify(scoreById);

  const sheet = _sheet_("EVALUATIONS");
  const idx = _findRowByKey_(sheet, "eval_id", evalId);

  const rowObj = {
    eval_id: evalId,
    student_id: studentId,
    student_name: st.name || "",
    date: date,
    period_tag: periodTag,
    evaluator: evaluator,
    scores_json: scoresJson,
    scores_avg_0_10: String(avg),
    auto_summary: autoSummary,
    written_report: writtenReport,
    created_at: now,
    updated_at: now
  };

  if (idx.rowNumber === 0) _appendObjectRow_(sheet, rowObj);
  else {
    rowObj.created_at = idx.row.created_at || now;
    _updateObjectRow_(sheet, idx.rowNumber, rowObj);
  }

  return { ok: true, eval_id: evalId, auto_summary: autoSummary, avg_0_10: avg };
}

function _listEvaluationsByStudent_(req, ctx) {
  const studentId = String(req.student_id || "").trim();
  if (!studentId) throw new Error("student_id required");

  const evals = _getAll_("EVALUATIONS").filter(r => r.student_id === studentId);
  evals.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { ok: true, evaluations: evals, count: evals.length };
}

function _getStudentReport_(req, ctx) {
  const studentId = String(req.student_id || "").trim();
  if (!studentId) throw new Error("student_id required");

  const st = _getStudentById_(studentId);
  if (!st) throw new Error("Student not found");

  const evals = _getAll_("EVALUATIONS").filter(r => r.student_id === studentId);
  evals.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const latest = evals.length ? evals[evals.length - 1] : null;

  const timeline = evals.map(ev => {
    let scores = {};
    try { scores = JSON.parse(ev.scores_json || "{}"); } catch (_) { scores = {}; }
    return {
      date: ev.date,
      period_tag: ev.period_tag,
      avg_0_10: Number(ev.scores_avg_0_10 || "0"),
      scores: scores
    };
  });

  return { ok: true, student: st, latest_evaluation: latest, timeline: timeline };
}


/* ========================= Sponsor report (VIEWER-friendly, LGPD/minimização) ========================= */

function _getSponsorReport_(req, ctx) {
  const studentId = String(req.student_id || "").trim();
  if (!studentId) throw new Error("student_id required");

  const st = _getStudentById_(studentId);
  if (!st) throw new Error("Student not found");

  const evals = _getAll_("EVALUATIONS").filter(r => r.student_id === studentId);
  evals.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const latest = evals.length ? evals[evals.length - 1] : null;

  // Competências (tolerante com active)
  const compList = _getAll_("COMPETENCIES")
    .filter(c => String(c.active || "TRUE").toUpperCase().trim() === "TRUE");

  let scoreById = {};
  if (latest) {
    try { scoreById = JSON.parse(latest.scores_json || "{}"); } catch (_) { scoreById = {}; }
  }

  const overview = _buildSponsorOverview_(compList, scoreById);

  const out = {
    ok: true,
    student: {
      student_id: st.student_id,
      name: st.name || "",
      sector_current_name: st.sector_current_name || "",
      scholarship_type_name: st.scholarship_type_name || ""
    },
    latest: latest ? {
      date: latest.date || "",
      period_tag: latest.period_tag || "",
      avg_0_10: Number(latest.scores_avg_0_10 || "0")
    } : null,
    sponsor_report: {
      highlights: overview.highlights,
      next_steps: overview.next_steps,
      competencies: overview.competencies,
      overall_band: overview.overall_band,
      note: "Resumo de acompanhamento com linguagem neutra e foco formativo (para prestação de contas/apoio)."
    }
  };

  return out;
}

function _buildSponsorOverview_(compList, scoreById) {
  const items = (compList || []).map(c => {
    const raw = scoreById && scoreById[c.comp_id] !== undefined ? Number(scoreById[c.comp_id]) : null;
    const score = (raw === null || isNaN(raw)) ? null : raw;
    return {
      comp_id: c.comp_id,
      name: c.name || "",
      score_0_10: score,
      band: (score === null ? "" : _band_(score))
    };
  });

  const scored = items.filter(x => x.score_0_10 !== null);
  scored.sort((a, b) => b.score_0_10 - a.score_0_10);

  // Highlights: até 2 pontos fortes (se houver nota)
  const highlights = [];
  if (scored.length) {
    const top1 = scored[0];
    highlights.push(_sponsorStrengthLine_(top1));
    if (scored.length > 1) highlights.push(_sponsorStrengthLine_(scored[1]));
  } else {
    highlights.push("Sem notas registradas no período atual.");
  }

  // Next step: baseado no menor score (se houver)
  let next_steps = [];
  if (scored.length) {
    const worst = scored[scored.length - 1];
    next_steps = [_sponsorNextStepLine_(worst)];
  } else {
    next_steps = ["Próximo passo: registrar a primeira avaliação para orientar o acompanhamento."];
  }

  const overall_band = _sponsorOverallBand_(scored);

  // Competências: minimizar exposição (usar faixa + opcionalmente nota)
  const competencies = items.map(it => ({
    name: it.name,
    band_label: _sponsorBandLabel_(it.band),
    score_0_10: (it.score_0_10 === null ? "" : String(it.score_0_10))
  }));

  return { highlights, next_steps, competencies, overall_band };
}

function _sponsorOverallBand_(scored) {
  if (!scored || !scored.length) return "Sem dados";
  var sum = 0;
  for (var i = 0; i < scored.length; i++) sum += Number(scored[i].score_0_10 || 0);
  var avg = sum / scored.length;
  return _sponsorBandLabel_(_band_(avg));
}

function _sponsorBandLabel_(band) {
  if (band === "low") return "Em desenvolvimento";
  if (band === "mid") return "Em progresso";
  if (band === "good") return "Bom";
  if (band === "top") return "Excelente";
  return "—";
}

function _sponsorStrengthLine_(item) {
  var label = _sponsorBandLabel_(item.band);
  if (!item || item.score_0_10 === null) return "Ponto forte: —";
  // linguagem de reforço + observável
  if (item.band === "top") return "Destaque: " + item.name + " em nível excelente (nota " + item.score_0_10 + "/10).";
  if (item.band === "good") return "Destaque: " + item.name + " em bom nível (nota " + item.score_0_10 + "/10).";
  if (item.band === "mid") return "Ponto positivo: " + item.name + " em progresso (nota " + item.score_0_10 + "/10).";
  return "Ponto positivo: " + item.name + " em desenvolvimento (nota " + item.score_0_10 + "/10).";
}

function _sponsorNextStepLine_(worst) {
  if (!worst) return "Próximo passo: manter acompanhamento e registrar observações objetivas.";
  var n = _norm_(worst.name || "");
  var band = worst.band || _band_(Number(worst.score_0_10 || 0));

  // linguagem neutra + ação curta, sem rótulo
  if (_has_(n, "assid")) return "Próximo passo: reforçar rotina de presença/registro e revisar semanalmente.";
  if (_has_(n, "espir")) return "Próximo passo: apoiar hábitos e participação com metas simples e acompanhamento regular.";
  if (_has_(n, "nota") || _has_(n, "escolar")) return "Próximo passo: apoiar estudo e organização acadêmica com metas semanais e monitoramento.";
  if (_has_(n, "projet")) return "Próximo passo: alinhar expectativas com o responsável e revisar entregas em 14 dias.";
  if (_has_(n, "respe")) return "Próximo passo: reforçar combinados de convivência e acompanhar a consistência nas próximas semanas.";

  if (band === "low" || band === "mid") return "Próximo passo: combinar 1 meta objetiva, 1 indicador e revisar em 14 dias.";
  return "Próximo passo: manter rotina e reforçar consistência com feedback regular.";
}

/* ========================= Auto-summary engine ========================= */

function _buildAutoSummary_(compList, scoreById) {
  if (!compList || !compList.length) return "Competências não configuradas.\nSem resumo automático.\n";

  const items = compList.map(c => ({
    comp: c,
    score: (scoreById[c.comp_id] !== undefined ? Number(scoreById[c.comp_id]) : null)
  }));

  const scored = items.filter(x => x.score !== null && !isNaN(x.score));
  if (!scored.length) {
    return "Avaliação registrada.\nSem notas suficientes para gerar resumo automático.\n";
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const worst = scored[scored.length - 1];

  const line1 = _summaryLine_(best.comp.name, best.score, "best");
  const line2 = _summaryLine_(worst.comp.name, worst.score, "worst");
  const line3 = _actionLine_(best, worst);

  return [line1, line2, line3].join("\n");
}

function _summaryLine_(compName, score, mode) {
  const band = _band_(score);
  const n = _norm_(compName);

  const dict = {
    assiduidade: {
      low: "Assiduidade baixa; faltas recorrentes podem comprometer o programa.",
      mid: "Assiduidade irregular; precisa de acompanhamento e combinados claros.",
      good: "Assiduidade consistente; mantém rotina estável.",
      top: "Assiduidade excelente; presença e pontualidade acima do esperado."
    },
    respeito: {
      low: "Respeito é um ponto crítico; há sinais de conflito com regras ou pessoas.",
      mid: "Respeito requer atenção; comportamento oscila em situações específicas.",
      good: "Respeito adequado; postura geralmente positiva.",
      top: "Respeito exemplar; contribui para um ambiente saudável."
    },
    "exercicio da funcao": {
      low: "Execução da função abaixo do esperado; precisa de orientação e checklist.",
      mid: "Execução da função irregular; falta consistência ou autonomia.",
      good: "Executa bem a função; desempenho confiável na maior parte do tempo.",
      top: "Execução da função excelente; alta autonomia e qualidade."
    },
    contentamento: {
      low: "Contentamento baixo; sinais de desmotivação ou insatisfação frequente.",
      mid: "Contentamento oscilante; precisa de escuta e ajustes pontuais.",
      good: "Contentamento adequado; mantém estabilidade na rotina.",
      top: "Contentamento alto; atitude positiva e colaborativa."
    },
    "notas escolares": {
      low: "Notas escolares preocupam; risco acadêmico requer plano de apoio.",
      mid: "Notas escolares medianas; há espaço claro para melhoria.",
      good: "Notas escolares boas; desempenho consistente.",
      top: "Notas escolares excelentes; desempenho de destaque."
    },
        projeto: {
      low: "Projeto está crítico; há retorno fraco do responsável e/ou entregas insuficientes. Precisa de orientação e acompanhamento próximo.",
      mid: "Projeto oscila; há inconsistência nas entregas ou necessidade de supervisão mais frequente.",
      good: "Projeto está bom; há retorno positivo e entregas adequadas, com pequenos pontos de melhoria.",
      top: "Projeto excelente; retorno muito positivo do responsável, com entregas consistentes e autonomia."
    },
espiritualidade: {
      low: "Espiritualidade como ponto frágil; requer acompanhamento estruturado.",
      mid: "Espiritualidade em desenvolvimento; encorajar hábitos e participação.",
      good: "Espiritualidade saudável; demonstra coerência com valores.",
      top: "Espiritualidade forte; influência positiva e exemplo."
    }
  };

  const key = _closestKey_(n, Object.keys(dict));
  const tpl = dict[key];

  let msg;
  if (!tpl) {
    if (band === "low") msg = compName + " está crítico (0–3).";
    else if (band === "mid") msg = compName + " requer atenção (4–6).";
    else if (band === "good") msg = compName + " está bom (7–8).";
    else msg = compName + " está excelente (9–10).";
  } else {
    if (band === "low") msg = tpl.low;
    else if (band === "mid") msg = tpl.mid;
    else if (band === "good") msg = tpl.good;
    else msg = tpl.top;
  }

  if (mode === "best") return "Ponto forte: " + msg + " (nota " + score + "/10)";
  return "Ponto de atenção: " + msg + " (nota " + score + "/10)";
}

function _actionLine_(best, worst) {
  const worstName = _norm_(worst.comp.name);
  const worstBand = _band_(worst.score);

  if (worstBand === "low") {
    if (_has_(worstName, "assid")) return "Ação sugerida: formalizar rotina (horário/registro), mapear causas das faltas e revisar semanalmente.";
    if (_has_(worstName, "respe")) return "Ação sugerida: intervenção comportamental objetiva, com acompanhamento da coordenação.";
    if (_has_(worstName, "func")) return "Ação sugerida: treinamento guiado no setor, checklist diário e revisão em 14 dias.";
    if (_has_(worstName, "projet")) return "Ação sugerida: alinhar expectativas com o responsável, definir checklist semanal e revisar entregas em 14 dias.";
    if (_has_(worstName, "nota")) return "Ação sugerida: plano acadêmico com metas semanais e monitoramento.";
    if (_has_(worstName, "espir")) return "Ação sugerida: acompanhamento espiritual estruturado e metas simples de hábito/participação.";
    return "Ação sugerida: definir 1 meta principal, 1 métrica e revisão semanal por 4 semanas.";
  }

  if (worstBand === "mid") {
    return "Ação sugerida: alinhar expectativas, combinar metas de curto prazo e revisar em 14 dias.";
  }

  return "Ação sugerida: manter rotina e reforçar consistência com feedback regular.";
}

function _band_(score) {
  const s = Number(score);
  if (s <= 3) return "low";
  if (s <= 6) return "mid";
  if (s <= 8) return "good";
  return "top";
}

function _closestKey_(normName, keys) {
  // aliases simples (mapeia nomes comuns do sistema)
  if (_has_(normName, "escolar")) return "notas escolares";
  if (_has_(normName, "nota")) return "notas escolares";

  for (var i = 0; i < keys.length; i++) {
    if (_has_(normName, keys[i])) return keys[i];
  }
  return "";
}

/* ========================= Users admin endpoints ========================= */

function _createUser_(req, ctx) {
  const p = req.user || req;

  const login = String(p.login || "").trim();
  const password = String(p.password || "");
  const role = String(p.role || "VIEWER").trim().toUpperCase();
  const active = String(p.active || "TRUE").toUpperCase() === "FALSE" ? "FALSE" : "TRUE";

  if (!login) throw new Error("user.login is required");
  if (!password) throw new Error("user.password is required");
  if (password.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres");
  if (role !== "VIEWER" && role !== "EDITOR") throw new Error("user.role must be VIEWER or EDITOR");

  const existing = _getUserByLogin_(login);
  if (existing) throw new Error("Login already exists");

  const salt = _getSetting_("PASSWORD_SALT", "");
  if (!salt || salt === "change-me") {
    _setSetting_("PASSWORD_SALT", _randToken_(), "Salt para hash de senha");
  }
  const finalSalt = _getSetting_("PASSWORD_SALT", "change-me");
  const hash = _sha256Base64_(finalSalt + ":" + password);

  const userId = _uuid_();
  const now = _nowIso_();

  _appendRow_("USERS", [
    userId,
    login,
    hash,
    role,
    active,
    "",
    now,
    now
  ]);

  return { ok: true, user_id: userId, login: login, role: role, active: active };
}

function _changePassword_(req, ctx) {
  const p = req.payload || req;

  const login = String(p.login || "").trim();
  const userId = String(p.user_id || "").trim();
  const newPassword = String(p.new_password || "");

  if (!newPassword) throw new Error("new_password is required");
  if (newPassword.length < 8) throw new Error("A nova senha deve ter pelo menos 8 caracteres");
  if (!login && !userId) throw new Error("login or user_id is required");

  let user = null;
  if (userId) user = _getUserById_(userId);
  if (!user && login) user = _getUserByLogin_(login);
  if (!user) throw new Error("User not found");

  const salt = _getSetting_("PASSWORD_SALT", "");
  if (!salt || salt === "change-me") {
    _setSetting_("PASSWORD_SALT", _randToken_(), "Salt para hash de senha");
  }
  const finalSalt = _getSetting_("PASSWORD_SALT", "change-me");
  const hash = _sha256Base64_(finalSalt + ":" + newPassword);

  const sh = _sheet_("USERS");
  const idx = _findRowByKey_(sh, "user_id", user.user_id);
  if (!idx.rowNumber) throw new Error("User row not found");

  idx.row.password_hash = hash;
  idx.row.updated_at = _nowIso_();
  _updateObjectRow_(sh, idx.rowNumber, idx.row);

  const revoke = String(p.revoke_sessions || "TRUE").toUpperCase() === "TRUE";
  if (revoke) _revokeAllSessionsByUser_(user.user_id);

  return { ok: true, user_id: user.user_id, login: user.login, revoked_sessions: revoke };
}

function _revokeAllSessionsByUser_(userId) {
  const sh = _sheet_("SESSIONS");
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const headers = _headers_(sh);
  const colUser = headers.indexOf("user_id") + 1;
  const colRevoked = headers.indexOf("revoked") + 1;
  if (colUser <= 0 || colRevoked <= 0) return;

  const rng = sh.getRange(2, 1, lastRow - 1, headers.length);
  const values = rng.getValues();

  let changed = false;
  for (var i = 0; i < values.length; i++) {
    const rowUser = String(values[i][colUser - 1] || "");
    if (rowUser === userId) {
      values[i][colRevoked - 1] = "TRUE";
      changed = true;
    }
  }
  if (changed) rng.setValues(values);
}

/* ========================= Sheet helpers ========================= */

function _sheet_(name) {
  if (_sheetRuntimeCache[name]) return _sheetRuntimeCache[name];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error("Missing sheet: " + name);
  _sheetRuntimeCache[name] = sh;
  return sh;
}

function _getAll_(sheetName) {
  if (_rowsRuntimeCache[sheetName]) return _rowsRuntimeCache[sheetName];

  const cached = _readSheetCache_(sheetName);
  if (cached) {
    _rowsRuntimeCache[sheetName] = cached;
    return cached;
  }

  const sh = _sheet_(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return [];

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const rows = values.map(row => {
    const obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = String(row[c] !== undefined ? row[c] : "");
    return obj;
  });

  _rowsRuntimeCache[sheetName] = rows;
  _writeSheetCache_(sheetName, rows);
  return rows;
}

function _appendRow_(sheetName, rowArray) {
  const sh = _sheet_(sheetName);
  sh.getRange(sh.getLastRow() + 1, 1, 1, rowArray.length).setValues([rowArray]);
  _invalidateSheetCache_(sheetName);
}

function _appendObjectRow_(sheet, obj) {
  const headers = _headers_(sheet);
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ""));
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  _invalidateSheetCache_(sheet.getName());
}

function _updateObjectRow_(sheet, rowNumber, obj) {
  const headers = _headers_(sheet);
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ""));
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
  _invalidateSheetCache_(sheet.getName());
}

function _headers_(sheet) {
  const name = sheet.getName();
  if (_headersRuntimeCache[name]) return _headersRuntimeCache[name];
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  _headersRuntimeCache[name] = headers;
  return headers;
}

function _sheetCacheKey_(sheetName) {
  return PROFILE_CACHE_PREFIX + "sheet:" + sheetName;
}

function _readSheetCache_(sheetName) {
  if (!PROFILE_CACHEABLE_SHEETS[sheetName]) return null;
  try {
    const value = CacheService.getScriptCache().get(_sheetCacheKey_(sheetName));
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

function _writeSheetCache_(sheetName, rows) {
  const ttl = PROFILE_CACHEABLE_SHEETS[sheetName];
  if (!ttl) return;
  try {
    const value = JSON.stringify(rows);
    if (value.length < 95000) CacheService.getScriptCache().put(_sheetCacheKey_(sheetName), value, ttl);
  } catch (_) {}
}

function _invalidateSheetCache_(sheetName) {
  delete _rowsRuntimeCache[sheetName];
  if (!PROFILE_CACHEABLE_SHEETS[sheetName]) return;
  try { CacheService.getScriptCache().remove(_sheetCacheKey_(sheetName)); } catch (_) {}
}

function _findRowByKey_(sheet, keyHeader, keyValue) {
  const headers = _headers_(sheet);
  const keyCol = headers.indexOf(keyHeader) + 1;
  if (keyCol <= 0) throw new Error("Missing key column: " + keyHeader);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { rowNumber: 0, row: null };

  const values = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues().flat().map(String);
  for (var i = 0; i < values.length; i++) {
    if (values[i] === keyValue) {
      const rowNum = i + 2;
      const rowObj = _rowToObj_(sheet, rowNum);
      return { rowNumber: rowNum, row: rowObj };
    }
  }
  return { rowNumber: 0, row: null };
}

function _rowToObj_(sheet, rowNumber) {
  const headers = _headers_(sheet);
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const obj = {};
  for (var i = 0; i < headers.length; i++) obj[headers[i]] = String(row[i] !== undefined ? row[i] : "");
  return obj;
}

/* ========================= Domain helpers ========================= */

function _getStudentById_(studentId) {
  const sh = _sheet_("STUDENTS");
  const idx = _findRowByKey_(sh, "student_id", studentId);
  return idx.rowNumber ? idx.row : null;
}

function _getUserByLogin_(login) {
  const rows = _getAll_("USERS");
  return rows.find(r => (r.login || "") === login) || null;
}

function _getUserById_(userId) {
  const rows = _getAll_("USERS");
  return rows.find(r => (r.user_id || "") === userId) || null;
}

function _getSessionByToken_(token) {
  const sh = _sheet_("SESSIONS");
  const idx = _findRowByKey_(sh, "session_token", token);
  return idx.rowNumber ? idx.row : null;
}

function _revokeSession_(token) {
  const sh = _sheet_("SESSIONS");
  const idx = _findRowByKey_(sh, "session_token", token);
  if (!idx.rowNumber) return;

  idx.row.revoked = "TRUE";
  _updateObjectRow_(sh, idx.rowNumber, idx.row);
}

function _updateUserLastLogin_(userId) {
  const sh = _sheet_("USERS");
  const idx = _findRowByKey_(sh, "user_id", userId);
  if (!idx.rowNumber) return;

  idx.row.last_login_at = _nowIso_();
  idx.row.updated_at = _nowIso_();
  _updateObjectRow_(sh, idx.rowNumber, idx.row);
}

/* ========================= Settings ========================= */

function _getSetting_(key, fallback) {
  const rows = _getAll_("SETTINGS");
  const r = rows.find(x => (x.key || "") === key);
  return r ? String(r.value || "") : fallback;
}

function _setSetting_(key, value, description) {
  const sh = _sheet_("SETTINGS");
  const idx = _findRowByKey_(sh, "key", key);
  const now = _nowIso_();

  const rowObj = {
    key: key,
    value: String(value),
    description: String(description || ""),
    updated_at: now
  };

  if (!idx.rowNumber) _appendObjectRow_(sh, rowObj);
  else _updateObjectRow_(sh, idx.rowNumber, rowObj);
}

/* ========================= Utils ========================= */

function _avgScores_(scoreById) {
  const keys = Object.keys(scoreById || {});
  if (!keys.length) return 0;

  let sum = 0;
  let n = 0;
  keys.forEach(k => {
    const v = Number(scoreById[k]);
    if (!isNaN(v)) { sum += v; n++; }
  });
  return n ? Math.round((sum / n) * 100) / 100 : 0;
}

function _calcAge_(birthDate) {
  const parts = String(birthDate).split("-");
  if (parts.length !== 3) return "";
  const y = Number(parts[0]), m = Number(parts[1]) - 1, d = Number(parts[2]);
  const dob = new Date(y, m, d);
  if (isNaN(dob.getTime())) return "";

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const mm = now.getMonth() - dob.getMonth();
  if (mm < 0 || (mm === 0 && now.getDate() < dob.getDate())) age--;
  return String(age);
}

function _normalizePhoneE164_(phone, defaultCountryCode) {
  let p = String(phone || "").trim();
  if (!p) return "";
  p = p.replace(/[^\d+]/g, "");
  if (p[0] === "+") return p;
  if (p.length >= 12 && p.indexOf(defaultCountryCode) === 0) return "+" + p;
  return "+" + defaultCountryCode + p;
}

function _uuid_() {
  return Utilities.getUuid();
}

function _nowIso_() {
  return _formatDateTime_(new Date());
}

function _today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function _formatDateTime_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function _randToken_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(Math.random()) + ":" + String(Date.now()));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function _sha256Base64_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function _clamp_(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function _norm_(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _has_(hay, needle) {
  return String(hay || "").indexOf(String(needle || "")) !== -1;
}

/* ========================= Output / CORS ========================= */

function _corsJsonOutput_(obj) {
  const out = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);

  try {
    out.setHeader("Access-Control-Allow-Origin", "*");
    out.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    out.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  } catch (_) {}

  return out;
}

function _corsTextOutput_(txt) {
  const out = ContentService
    .createTextOutput(String(txt || ""))
    .setMimeType(ContentService.MimeType.TEXT);

  try {
    out.setHeader("Access-Control-Allow-Origin", "*");
    out.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    out.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  } catch (_) {}

  return out;
}

function _error_(msg, code) {
  return _corsJsonOutput_({ ok: false, error: msg, code: code || 500 });
}

/* ========================= Bootstrap seguro do primeiro usuário =========================
 * Defina temporariamente estas Script Properties antes de executar:
 * - INITIAL_USER_LOGIN
 * - INITIAL_USER_PASSWORD (mínimo 8 caracteres)
 * - INITIAL_USER_ROLE (EDITOR ou VIEWER)
 * A senha é removida das propriedades assim que o usuário é criado.
 */
function seedInitialUserFromProperties() {
  const properties = PropertiesService.getScriptProperties();
  const login = String(properties.getProperty("INITIAL_USER_LOGIN") || "").trim();
  const password = String(properties.getProperty("INITIAL_USER_PASSWORD") || "");
  const role = String(properties.getProperty("INITIAL_USER_ROLE") || "EDITOR").toUpperCase();

  if (!login) throw new Error("Configure INITIAL_USER_LOGIN nas propriedades do script");
  if (password.length < 8) throw new Error("INITIAL_USER_PASSWORD deve ter pelo menos 8 caracteres");
  if (role !== "EDITOR" && role !== "VIEWER") throw new Error("INITIAL_USER_ROLE deve ser EDITOR ou VIEWER");
  if (_getUserByLogin_(login)) throw new Error("O login informado já existe");

  let salt = _getSetting_("PASSWORD_SALT", "");
  if (!salt || salt === "change-me") {
    salt = _randToken_();
    _setSetting_("PASSWORD_SALT", salt, "Salt para hash de senha");
  }

  const now = _nowIso_();
  _appendRow_("USERS", [
    _uuid_(), login, _sha256Base64_(salt + ":" + password), role, "TRUE", "", now, now
  ]);
  properties.deleteProperty("INITIAL_USER_PASSWORD");
  Logger.log("Usuário inicial criado com segurança: " + login + " (" + role + ")");
}
