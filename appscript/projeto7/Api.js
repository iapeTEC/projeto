/* =========================
 * API (Web App) - Api.gs (FULL)
 * =========================
 * Roteamento por action:
 * - ping
 * - requestLoginCode, verifyLoginCode, logout, me
 *
 * USER/EDITOR/ADMIN/OWNER (relatórios e consultas):
 * - listStudents
 * - listSectors
 * - listScholarshipTypes
 * - listCompetencies
 * - listEvaluationsByStudent
 * - getStudentReport
 *
 * EDITOR/ADMIN/OWNER (cadastros/edições):
 * - upsertStudent, deactivateStudent, setStudentSector
 * - upsertSector
 * - upsertScholarshipType
 * - upsertCompetency
 * - createEvaluation
 * Somente OWNER:
 * - listUsers, upsertUser, revokeUserSessions
 *
 * Segurança:
 * - código temporário enviado por e-mail -> session_token (tabela SESSIONS)
 * - demais actions exigem token via:
 *   - Header Authorization: Bearer <token> (se vier)
 *   - OU body/query: token=<token> (fallback confiável)
 *
 * Requisitos:
 * - Rodar setupScholarshipSystem() do Code.gs antes.
 */

const PROFILE_API_VERSION = "3.0.0";
const PROFILE_CACHE_PREFIX = "profile-api:v3:";
const PROFILE_OWNER_EMAIL = "normafederal@gmail.com";
const PROFILE_ROLES = Object.freeze(["OWNER", "ADMIN", "EDITOR", "USER"]);
const PROFILE_LOGIN_CODE_TTL_SECONDS = 10 * 60;
const PROFILE_LOGIN_CODE_RESEND_SECONDS = 60;
const PROFILE_LOGIN_MAX_ATTEMPTS = 5;
const PROFILE_LOGIN_GLOBAL_HOURLY_LIMIT = 100;
const PROFILE_CACHEABLE_SHEETS = Object.freeze({
  STUDENTS: 300,
  SECTORS: 600,
  SCHOLARSHIP_TYPES: 600,
  COMPETENCIES: 600,
  EVALUATIONS: 120,
  SETTINGS: 300,
  USERS: 300
});
const PROFILE_SESSION_CACHE_SECONDS = 300;
const PROFILE_GOOGLE_CLIENT_ID_PROPERTY = "GOOGLE_CLIENT_ID";
const PROFILE_GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo?id_token=";
const PROFILE_GOOGLE_IDENTITY_CACHE_SECONDS = 300;

const _sheetRuntimeCache = {};
const _rowsRuntimeCache = {};
const _headersRuntimeCache = {};
let _profileAuthSchemaReady = false;

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
    if (action === "requestLoginCode") return _corsJsonOutput_(_requestLoginCode_(req));
    if (action === "verifyLoginCode") return _corsJsonOutput_(_verifyLoginCode_(req));
    if (action === "loginWithGoogle") return _corsJsonOutput_(_loginWithGoogle_(req));

    // Demais ações exigem autenticação
    const auth = _requireAuth_(req);
    const ctx = auth.ctx;

    switch (action) {
      case "logout":
        return _corsJsonOutput_(_logout_(req, ctx));

      case "me":
        return _corsJsonOutput_({ ok: true, user: _publicUser_(ctx.user) });

      /* ===== Relatórios / Consultas (usuários autenticados) ===== */

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
        _requireRole_(ctx, ["OWNER", "ADMIN", "EDITOR"]);
        return _corsJsonOutput_(_upsertStudent_(req, ctx));

      case "deactivateStudent":
        _requireRole_(ctx, ["OWNER", "ADMIN", "EDITOR"]);
        return _corsJsonOutput_(_deactivateStudent_(req, ctx));

      case "setStudentSector":
        _requireRole_(ctx, ["OWNER", "ADMIN", "EDITOR"]);
        return _corsJsonOutput_(_setStudentSector_(req, ctx));

      case "upsertSector":
        _requireRole_(ctx, ["OWNER", "ADMIN"]);
        return _corsJsonOutput_(_upsertSector_(req, ctx));

      case "upsertScholarshipType":
        _requireRole_(ctx, ["OWNER", "ADMIN"]);
        return _corsJsonOutput_(_upsertScholarshipType_(req, ctx));

      case "upsertCompetency":
        _requireRole_(ctx, ["OWNER", "ADMIN"]);
        return _corsJsonOutput_(_upsertCompetency_(req, ctx));

      case "createEvaluation":
        _requireRole_(ctx, ["OWNER", "ADMIN", "EDITOR"]);
        return _corsJsonOutput_(_createEvaluation_(req, ctx));

      /* ===== Admin de usuários (somente proprietário) ===== */

      case "listUsers":
        _requireRole_(ctx, ["OWNER"]);
        return _corsJsonOutput_(_listUsers_(req, ctx));

      case "upsertUser":
        _requireRole_(ctx, ["OWNER"]);
        return _corsJsonOutput_(_upsertUser_(req, ctx));

      case "revokeUserSessions":
        _requireRole_(ctx, ["OWNER"]);
        return _corsJsonOutput_(_revokeUserSessions_(req, ctx));

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
  _ensureAuthSchemaAndOwner_();
  const token = _getTokenFromReq_(req);
  if (!token) throw new Error("Missing session token");

  const cachedAuth = _readAuthCache_(token);
  if (cachedAuth) {
    return { ok: true, ctx: { token: token, session: cachedAuth.session, user: cachedAuth.user } };
  }

  const sess = _getSessionByToken_(token);
  if (!sess) throw new Error("Invalid session token");
  if (_isTruthy_(sess.revoked)) throw new Error("Session revoked");
  const expiresAt = new Date(sess.expires_at).getTime();
  if (!isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Session expired");

  const user = _getUserById_(sess.user_id);
  if (!user) throw new Error("User not found");
  if (String(user.active || "").toUpperCase() !== "TRUE") throw new Error("User inactive");
  if (String(sess.auth_version || "1") !== String(user.auth_version || "1")) {
    throw new Error("Session revoked");
  }

  const publicUser = _publicUser_(user);
  _writeAuthCache_(token, sess, publicUser);
  return { ok: true, ctx: { token: token, session: sess, user: publicUser } };
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

function _requestLoginCode_(req) {
  _ensureAuthSchemaAndOwner_();
  const email = _normalizeEmail_(req.email);
  if (!_isValidEmail_(email)) return { ok: false, error: "Informe um e-mail válido." };

  const cache = CacheService.getScriptCache();
  const emailKey = _sha256Base64_(email);
  const cooldownKey = PROFILE_CACHE_PREFIX + "otp-cooldown:" + emailKey;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let challengeId = "";
  let code = "";
  let shouldSend = false;
  try {
    const recent = cache.get(cooldownKey);
    if (recent) {
      const saved = JSON.parse(recent);
      challengeId = String(saved.challenge_id || "");
      if (challengeId) return _loginCodeRequested_(challengeId);
    }

    const user = _getUserByEmail_(email);
    const allowed = !!user && String(user.active || "").toUpperCase() === "TRUE";
    challengeId = _secureToken_();
    code = _generateLoginCode_();
    const challenge = {
      challenge_id: challengeId,
      email: email,
      user_id: allowed ? String(user.user_id || "") : "",
      code_hash: _loginCodeHash_(challengeId, email, code),
      allowed: allowed,
      attempts: 0,
      expires_at: Date.now() + PROFILE_LOGIN_CODE_TTL_SECONDS * 1000
    };
    cache.put(_loginChallengeKey_(challengeId), JSON.stringify(challenge), PROFILE_LOGIN_CODE_TTL_SECONDS);
    cache.put(cooldownKey, JSON.stringify({ challenge_id: challengeId }), PROFILE_LOGIN_CODE_RESEND_SECONDS);

    const hourlyKey = PROFILE_CACHE_PREFIX + "otp-hour:" + emailKey;
    const hourlyCount = Number(cache.get(hourlyKey) || "0");
    cache.put(hourlyKey, String(hourlyCount + 1), 60 * 60);
    const globalHourlyKey = PROFILE_CACHE_PREFIX + "otp-hour:global";
    const globalHourlyCount = Number(cache.get(globalHourlyKey) || "0");
    if (allowed) cache.put(globalHourlyKey, String(globalHourlyCount + 1), 60 * 60);
    shouldSend = allowed && hourlyCount < 6 && globalHourlyCount < PROFILE_LOGIN_GLOBAL_HOURLY_LIMIT;
  } finally {
    lock.releaseLock();
  }

  if (shouldSend) {
    try {
      if (MailApp.getRemainingDailyQuota() < 1) throw new Error("Limite diário de e-mails atingido");
      MailApp.sendEmail({
        to: email,
        subject: "Seu código de acesso • IAPE",
        name: "IAPE • Gestão Estudantil",
        body: "Seu código de acesso é " + code + ". Ele expira em 10 minutos. Se você não solicitou este código, ignore esta mensagem.",
        htmlBody: "<p>Seu código de acesso ao <strong>IAPE • Gestão Estudantil</strong> é:</p>" +
          "<p style=\"font-size:28px;font-weight:700;letter-spacing:6px\">" + code + "</p>" +
          "<p>Ele expira em 10 minutos. Se você não solicitou este código, ignore esta mensagem.</p>"
      });
    } catch (error) {
      cache.remove(_loginChallengeKey_(challengeId));
      cache.remove(cooldownKey);
      return { ok: false, error: "Não foi possível enviar o código agora. Tente novamente em instantes." };
    }
  }

  return _loginCodeRequested_(challengeId);
}

/**
 * Execute uma vez no editor após adicionar o login por e-mail. A execução abre
 * o consentimento do Google para o MailApp e confirma a cota disponível sem
 * enviar mensagem alguma.
 */
function authorizeMailForLogin() {
  const remaining = MailApp.getRemainingDailyQuota();
  if (remaining < 1) throw new Error("A cota diária de e-mail está indisponível");
  console.log("MailApp autorizado. Cota restante: " + remaining);
  return remaining;
}

function _verifyLoginCode_(req) {
  _ensureAuthSchemaAndOwner_();
  const email = _normalizeEmail_(req.email);
  const challengeId = String(req.challenge_id || "").trim();
  const code = String(req.code || "").replace(/\D/g, "");
  if (!_isValidEmail_(email) || !challengeId || !/^\d{6}$/.test(code)) {
    return { ok: false, error: "Código inválido ou expirado." };
  }

  const cache = CacheService.getScriptCache();
  const challengeKey = _loginChallengeKey_(challengeId);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let user = null;
  try {
    const raw = cache.get(challengeKey);
    if (!raw) return { ok: false, error: "Código inválido ou expirado." };
    const challenge = JSON.parse(raw);
    const expired = Number(challenge.expires_at || 0) <= Date.now();
    const matches = !expired && challenge.email === email && challenge.allowed === true &&
      _constantTimeEqual_(challenge.code_hash, _loginCodeHash_(challengeId, email, code));

    if (!matches) {
      challenge.attempts = Number(challenge.attempts || 0) + 1;
      if (expired || challenge.attempts >= PROFILE_LOGIN_MAX_ATTEMPTS) cache.remove(challengeKey);
      else {
        const remaining = Math.max(1, Math.floor((Number(challenge.expires_at) - Date.now()) / 1000));
        cache.put(challengeKey, JSON.stringify(challenge), remaining);
      }
      return { ok: false, error: "Código inválido ou expirado." };
    }

    user = _getUserById_(challenge.user_id) || _getUserByEmail_(email);
    if (!user || _normalizeEmail_(user.email || user.login) !== email ||
        String(user.active || "").toUpperCase() !== "TRUE") {
      cache.remove(challengeKey);
      return { ok: false, error: "Código inválido ou expirado." };
    }
    cache.remove(challengeKey);
  } finally {
    lock.releaseLock();
  }

  const session = _createSession_(user, req);
  _updateUserLastLogin_(user.user_id);
  _auditAuth_(user, "LOGIN_SUCCESS", user, {});
  return session;
}

/* ========================= Login com conta Google ========================= */

function _googleClientId_() {
  const value = String(
    PropertiesService.getScriptProperties().getProperty(PROFILE_GOOGLE_CLIENT_ID_PROPERTY) || ""
  ).trim();
  if (!value) {
    throw new Error(
      "Login Google indisponível: defina a propriedade de script " +
      PROFILE_GOOGLE_CLIENT_ID_PROPERTY + " com o Client ID OAuth do site."
    );
  }
  return value;
}

/**
 * Confere o ID token emitido pelo Google Identity Services.
 * O token é público e curto (≈1h), então a validação é feita no Google e o
 * resultado fica em cache pelo tempo restante — sem isso, cada chamada de login
 * pagaria um UrlFetch inteiro.
 */
function _verifyGoogleIdToken_(idToken) {
  const token = String(idToken || "");
  if (token.length < 100 || token.length > 10000) throw new Error("Identidade Google inválida.");

  const cacheKey = PROFILE_CACHE_PREFIX + "gid:" + _sha256Base64_(token);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }

  const clientId = _googleClientId_();
  let response;
  try {
    response = UrlFetchApp.fetch(PROFILE_GOOGLE_TOKENINFO_URL + encodeURIComponent(token), {
      muteHttpExceptions: true
    });
  } catch (err) {
    throw new Error("Não foi possível confirmar sua conta Google agora. Tente novamente.");
  }
  if (response.getResponseCode() !== 200) throw new Error("Sessão Google inválida ou expirada.");

  let claims = {};
  try { claims = JSON.parse(response.getContentText() || "{}"); } catch (_) { claims = {}; }

  if (claims.aud !== clientId) throw new Error("Aplicativo Google inválido.");
  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") {
    throw new Error("Emissor de identidade inválido.");
  }
  const expSeconds = Number(claims.exp || 0);
  if (!isFinite(expSeconds) || expSeconds * 1000 <= Date.now()) throw new Error("Sessão Google expirada.");
  if (String(claims.email_verified) !== "true") throw new Error("O e-mail da conta Google não foi verificado.");

  const identity = {
    email: _normalizeEmail_(claims.email),
    subject: String(claims.sub || ""),
    name: String(claims.name || "").slice(0, 160),
    picture: String(claims.picture || "").slice(0, 500),
    expires_at: new Date(expSeconds * 1000).toISOString()
  };
  if (!identity.email || !identity.subject) throw new Error("Identidade Google incompleta.");

  const ttl = Math.min(
    PROFILE_GOOGLE_IDENTITY_CACHE_SECONDS,
    Math.max(30, Math.floor(expSeconds - Date.now() / 1000))
  );
  cache.put(cacheKey, JSON.stringify(identity), ttl);
  return identity;
}

function _loginWithGoogle_(req) {
  _ensureAuthSchemaAndOwner_();
  const identity = _verifyGoogleIdToken_(req.credential || req.id_token || req.identity_token);

  const user = _getUserByEmail_(identity.email);
  if (!user || String(user.active || "").toUpperCase() !== "TRUE") {
    _auditAuth_(null, "LOGIN_GOOGLE_DENIED", { email: identity.email }, { subject: identity.subject });
    return {
      ok: false,
      code: 403,
      error: "A conta " + identity.email + " não tem acesso liberado. Fale com o responsável de TI."
    };
  }

  _syncGoogleIdentityOnUser_(user, identity);

  const session = _createSession_(user, req);
  _updateUserLastLogin_(user.user_id);
  _auditAuth_(user, "LOGIN_GOOGLE_SUCCESS", user, { subject: identity.subject });
  return session;
}

/**
 * Grava o identificador estável do Google (sub), o nome e a foto no cadastro.
 * Só escreve quando algo mudou de fato: o login roda a cada entrada e uma
 * escrita por login custaria uma linha de planilha em toda sessão.
 */
function _syncGoogleIdentityOnUser_(user, identity) {
  const patch = {};
  const previousSubject = String(user.google_subject || "").trim();
  if (previousSubject !== identity.subject) {
    patch.google_subject = identity.subject;
    if (previousSubject) {
      _auditAuth_(user, "GOOGLE_SUBJECT_CHANGED", user, { from: previousSubject, to: identity.subject });
    }
  }
  if (identity.name && String(user.display_name || "") !== identity.name) patch.display_name = identity.name;
  if (identity.picture && String(user.avatar_url || "") !== identity.picture) patch.avatar_url = identity.picture;
  if (!Object.keys(patch).length) return;

  patch.updated_at = _nowIso_();
  const sheet = _sheet_("USERS");
  const found = _findRowByKey_(sheet, "user_id", user.user_id);
  if (!found.rowNumber) return;
  _updateObjectFields_(sheet, found.rowNumber, patch, Object.keys(patch));
  Object.keys(patch).forEach(function (key) { user[key] = patch[key]; });
}

function _createSession_(user, req) {
  const sessionDays = Math.max(1, Math.min(30, Number(_getSetting_("SESSION_DAYS", "7")) || 7));
  const issued = new Date();
  const expires = new Date(issued.getTime() + sessionDays * 24 * 60 * 60 * 1000);
  const token = _secureToken_();
  const publicUser = _publicUser_(user);
  const session = {
    session_token: "",
    user_id: user.user_id,
    role: publicUser.role,
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString(),
    revoked: "FALSE",
    ip: "",
    user_agent: String(req.user_agent || "").slice(0, 300),
    session_id: _uuid_(),
    token_hash: _sessionTokenHash_(token),
    auth_version: String(user.auth_version || "1")
  };
  _appendObjectRow_(_sheet_("SESSIONS"), session);
  _writeAuthCache_(token, session, publicUser);
  return { ok: true, token: token, user: publicUser, expires_at: session.expires_at };
}

function _loginCodeRequested_(challengeId) {
  return {
    ok: true,
    challenge_id: challengeId,
    expires_in: PROFILE_LOGIN_CODE_TTL_SECONDS,
    message: "Se o e-mail estiver autorizado, o código chegará em instantes."
  };
}

function _logout_(req, ctx) {
  _revokeSession_(ctx.token);
  _removeAuthCache_(ctx.token);
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
  _requireRole_(ctx, ["OWNER", "ADMIN", "EDITOR"]);
  const students = _listStudents_({ filters: {} }, ctx);
  const result = {
    ok: true,
    students: students.students,
    sectors: _getAll_("SECTORS"),
    scholarship_types: _getAll_("SCHOLARSHIP_TYPES"),
    competencies: _getAll_("COMPETENCIES")
  };
  if (ctx.user.role === "OWNER") result.users = _getAll_("USERS").map(_publicUser_);
  return result;
}

function _getStudentProfile_(req, ctx) {
  const report = _getStudentReport_(req, ctx);
  report.competencies = _getAll_("COMPETENCIES")
    .filter(c => String(c.active || "TRUE").toUpperCase().trim() === "TRUE");
  return report;
}

function _upsertStudent_(req, ctx) {
  const p = req.student || req;
  const requestedStudentId = String(p.student_id || "").trim();
  const studentId = requestedStudentId || _uuid_();
  const sheet = _sheet_("STUDENTS");
  const idx = _findRowByKey_(sheet, "student_id", studentId);
  const rowObj = _buildStudentRow_(idx.row || {}, p, {
    studentId: studentId,
    now: _nowIso_(),
    countryCode: String(_getSetting_("DEFAULT_COUNTRY_CODE", "55")).trim(),
    isNew: idx.rowNumber === 0
  });

  if (!rowObj.name) throw new Error("student.name is required");

  if (idx.rowNumber === 0) {
    _appendObjectRow_(sheet, rowObj);
  } else if (Array.isArray(p.update_mask)) {
    _updateObjectFields_(sheet, idx.rowNumber, rowObj, _studentColumnsForMask_(p.update_mask));
  } else {
    _updateObjectRow_(sheet, idx.rowNumber, rowObj);
  }

  return { ok: true, student_id: studentId };
}

function _buildStudentRow_(existing, patch, options) {
  const base = existing || {};
  const p = patch || {};
  const opts = options || {};
  const isNew = !!opts.isNew;
  const updateMask = Array.isArray(p.update_mask)
    ? p.update_mask.map(String).filter(Boolean)
    : [];
  const hasMask = Array.isArray(p.update_mask);

  function supplied(key) {
    return Object.prototype.hasOwnProperty.call(p, key) && (!hasMask || updateMask.indexOf(key) !== -1);
  }

  function textValue(key, defaultValue) {
    if (supplied(key)) return String(p[key] === undefined || p[key] === null ? "" : p[key]).trim();
    const previous = base[key];
    if (previous !== undefined && previous !== null) return String(previous).trim();
    return String(defaultValue === undefined ? "" : defaultValue).trim();
  }

  const rawExistingBirthDate = String(base.birth_date || "").trim();
  let birthDate = _normalizeStudentDate_(rawExistingBirthDate) || rawExistingBirthDate;
  let birthDateChanged = false;
  if (supplied("birth_date")) {
    const rawBirthDate = String(p.birth_date === undefined || p.birth_date === null ? "" : p.birth_date).trim();
    const normalizedBirthDate = _normalizeStudentDate_(rawBirthDate);
    const clearBirthDate = p.clear_birth_date === true || String(p.clear_birth_date || "").toUpperCase() === "TRUE";

    if (rawBirthDate && !normalizedBirthDate) throw new Error("Data de nascimento inválida");
    if (normalizedBirthDate) {
      birthDateChanged = normalizedBirthDate !== (_normalizeStudentDate_(rawExistingBirthDate) || rawExistingBirthDate);
      birthDate = normalizedBirthDate;
    } else if (isNew || !rawExistingBirthDate || clearBirthDate) {
      birthDateChanged = !!rawExistingBirthDate;
      birthDate = "";
    }
    // Em atualizações antigas, um campo vazio sem confirmação nunca apaga a data existente.
  }

  let normalizedPhone = String(base.phone_e164 || "").trim();
  let phoneDisplay = String(base.phone_display || "").trim();
  if (supplied("phone") || supplied("phone_e164")) {
    const rawPhone = supplied("phone_e164") ? textValue("phone_e164") : textValue("phone");
    normalizedPhone = _normalizePhoneE164_(rawPhone, opts.countryCode || "55");
    phoneDisplay = supplied("phone_display") ? textValue("phone_display") : rawPhone;
  } else if (supplied("phone_display")) {
    phoneDisplay = textValue("phone_display");
  }

  let age = textValue("age");
  if ((isNew || birthDateChanged) && _normalizeStudentDate_(birthDate)) age = _calcAge_(birthDate);
  else if (birthDateChanged && !birthDate) age = "";

  const row = Object.assign({}, base, {
    student_id: String(opts.studentId || base.student_id || "").trim(),
    name: textValue("name"),
    sex: textValue("sex"),
    birth_date: birthDate,
    age: age,
    phone_e164: normalizedPhone,
    phone_display: phoneDisplay,
    whatsapp_link: normalizedPhone ? ("https://wa.me/" + normalizedPhone.replace("+", "")) : "",
    photo_url: textValue("photo_url"),
    scholarship_type_id: textValue("scholarship_type_id"),
    scholarship_type_name: textValue("scholarship_type_name"),
    sector_current_id: textValue("sector_current_id"),
    sector_current_name: textValue("sector_current_name"),
    workload_minutes: textValue("workload_minutes"),
    status: textValue("status", "ACTIVE") || "ACTIVE",
    notes: textValue("notes"),
    created_at: String(base.created_at || opts.now || "").trim(),
    updated_at: String(opts.now || "").trim()
  });

  return row;
}

function _studentColumnsForMask_(updateMask) {
  const mapping = {
    name: ["name"],
    sex: ["sex"],
    birth_date: ["birth_date", "age"],
    phone: ["phone_e164", "phone_display", "whatsapp_link"],
    phone_e164: ["phone_e164", "phone_display", "whatsapp_link"],
    phone_display: ["phone_display"],
    photo_url: ["photo_url"],
    scholarship_type_id: ["scholarship_type_id"],
    scholarship_type_name: ["scholarship_type_name"],
    sector_current_id: ["sector_current_id"],
    sector_current_name: ["sector_current_name"],
    workload_minutes: ["workload_minutes"],
    status: ["status"],
    notes: ["notes"]
  };
  const out = [];
  (Array.isArray(updateMask) ? updateMask : []).forEach(key => {
    (mapping[String(key)] || []).forEach(column => {
      if (out.indexOf(column) === -1) out.push(column);
    });
  });
  if (out.indexOf("updated_at") === -1) out.push("updated_at");
  return out;
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
  const evaluator = String(p.evaluator || ctx.user.email || ctx.user.login || "").trim();

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


/* ========================= Sponsor report (consulta, LGPD/minimização) ========================= */

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

/* ========================= Passwordless auth schema ========================= */

function _ensureAuthSchemaAndOwner_() {
  if (_profileAuthSchemaReady) return;
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("AUTH_SCHEMA_VERSION") === "4") {
    _profileAuthSchemaReady = true;
    return;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (properties.getProperty("AUTH_SCHEMA_VERSION") === "4") {
      _profileAuthSchemaReady = true;
      return;
    }

    const usersSheet = _sheet_("USERS");
    const userHeaders = _ensureSheetHeaders_(usersSheet, [
      "user_id", "login", "password_hash", "role", "active", "last_login_at",
      "created_at", "updated_at", "email", "auth_version", "invited_by", "invited_at",
      "google_subject", "display_name", "avatar_url"
    ]);
    const userValues = usersSheet.getLastRow() >= 2
      ? usersSheet.getRange(2, 1, usersSheet.getLastRow() - 1, userHeaders.length).getValues()
      : [];
    let ownerFound = false;
    const now = _nowIso_();

    userValues.forEach(function (row) {
      const get = function (name) { return row[userHeaders.indexOf(name)]; };
      const set = function (name, value) { row[userHeaders.indexOf(name)] = value; };
      const legacyLogin = _normalizeEmail_(get("login"));
      let email = _normalizeEmail_(get("email"));
      if (!email && _isValidEmail_(legacyLogin)) email = legacyLogin;
      const isOwner = email === PROFILE_OWNER_EMAIL || legacyLogin === PROFILE_OWNER_EMAIL;
      if (isOwner) {
        ownerFound = true;
        email = PROFILE_OWNER_EMAIL;
        set("role", "OWNER");
        set("active", "TRUE");
      } else {
        const migratedRole = _normalizeRole_(get("role"));
        set("role", migratedRole === "OWNER" ? "ADMIN" : migratedRole);
      }
      set("email", email);
      if (email) set("login", email);
      set("password_hash", "");
      set("auth_version", String(Math.max(1, Number(get("auth_version") || "1"))));
      if (!get("created_at")) set("created_at", now);
      set("updated_at", now);
    });
    if (userValues.length) {
      usersSheet.getRange(2, 1, userValues.length, userHeaders.length).setValues(userValues);
    }
    _invalidateSheetCache_("USERS");

    if (!ownerFound) {
      _appendObjectRow_(usersSheet, {
        user_id: _uuid_(),
        login: PROFILE_OWNER_EMAIL,
        password_hash: "",
        role: "OWNER",
        active: "TRUE",
        last_login_at: "",
        created_at: now,
        updated_at: now,
        email: PROFILE_OWNER_EMAIL,
        auth_version: "1",
        invited_by: "SYSTEM",
        invited_at: now,
        google_subject: "",
        display_name: "",
        avatar_url: ""
      });
    }

    const sessionsSheet = _sheet_("SESSIONS");
    const sessionHeaders = _ensureSheetHeaders_(sessionsSheet, [
      "session_token", "user_id", "role", "issued_at", "expires_at", "revoked",
      "ip", "user_agent", "session_id", "token_hash", "auth_version"
    ]);
    if (sessionsSheet.getLastRow() >= 2) {
      const sessionValues = sessionsSheet.getRange(
        2, 1, sessionsSheet.getLastRow() - 1, sessionHeaders.length
      ).getValues();
      const tokenColumn = sessionHeaders.indexOf("session_token");
      const revokedColumn = sessionHeaders.indexOf("revoked");
      sessionValues.forEach(function (row) {
        row[tokenColumn] = "";
        row[revokedColumn] = "TRUE";
      });
      sessionsSheet.getRange(2, 1, sessionValues.length, sessionHeaders.length).setValues(sessionValues);
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const auditSheet = spreadsheet.getSheetByName("AUTH_AUDIT") || spreadsheet.insertSheet("AUTH_AUDIT");
    _sheetRuntimeCache.AUTH_AUDIT = auditSheet;
    _ensureSheetHeaders_(auditSheet, [
      "event_id", "actor_user_id", "actor_email", "action", "target_user_id",
      "target_email", "details_json", "created_at"
    ]);

    properties.setProperty("AUTH_SCHEMA_VERSION", "4");
    _profileAuthSchemaReady = true;
  } finally {
    lock.releaseLock();
  }
}

function _ensureSheetHeaders_(sheet, requiredHeaders) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  let headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const missing = requiredHeaders.filter(function (header) { return headers.indexOf(header) === -1; });
  if (!headers.length) {
    headers = requiredHeaders.slice();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  delete _headersRuntimeCache[sheet.getName()];
  delete _rowsRuntimeCache[sheet.getName()];
  return headers;
}

function _normalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

function _isTruthy_(value) {
  return value === true || String(value || "").trim().toUpperCase() === "TRUE";
}

function _isValidEmail_(value) {
  const email = _normalizeEmail_(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function _normalizeRole_(value) {
  const role = String(value || "USER").trim().toUpperCase();
  if (role === "VIEWER") return "USER";
  return PROFILE_ROLES.indexOf(role) === -1 ? "USER" : role;
}

function _publicUser_(user) {
  const email = _normalizeEmail_(user && (user.email || user.login));
  const normalizedRole = _normalizeRole_(user && user.role);
  const role = email === PROFILE_OWNER_EMAIL
    ? "OWNER"
    : (normalizedRole === "OWNER" ? "ADMIN" : normalizedRole);
  return {
    user_id: String(user && user.user_id || ""),
    email: email,
    login: email,
    role: role,
    active: String(user && user.active || "TRUE").toUpperCase() !== "FALSE",
    last_login_at: String(user && user.last_login_at || ""),
    created_at: String(user && user.created_at || ""),
    updated_at: String(user && user.updated_at || ""),
    display_name: String(user && user.display_name || ""),
    avatar_url: String(user && user.avatar_url || "")
  };
}

function _loginChallengeKey_(challengeId) {
  return PROFILE_CACHE_PREFIX + "otp:" + _sha256Base64_(challengeId);
}

function _loginCodeHash_(challengeId, email, code) {
  const bytes = Utilities.computeHmacSha256Signature(
    String(challengeId) + ":" + _normalizeEmail_(email) + ":" + String(code),
    _loginPepper_(),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function _loginPepper_() {
  const properties = PropertiesService.getScriptProperties();
  let pepper = properties.getProperty("AUTH_PEPPER");
  if (!pepper) {
    pepper = _secureToken_();
    properties.setProperty("AUTH_PEPPER", pepper);
  }
  return pepper;
}

function _generateLoginCode_() {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    _secureToken_(),
    Utilities.Charset.UTF_8
  );
  let value = 0;
  for (var i = 0; i < 4; i++) value = (value * 256 + ((bytes[i] + 256) % 256)) >>> 0;
  return String(value % 1000000).padStart(6, "0");
}

function _constantTimeEqual_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (var i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function _secureToken_() {
  return _sha256Base64_([
    Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), String(Date.now())
  ].join(":"));
}

function _sessionTokenHash_(token) {
  return _sha256Base64_(String(token || ""));
}

function _auditAuth_(actor, action, target, details) {
  try {
    const sheet = _sheet_("AUTH_AUDIT");
    _appendObjectRow_(sheet, {
      event_id: _uuid_(),
      actor_user_id: String(actor && actor.user_id || ""),
      actor_email: _normalizeEmail_(actor && (actor.email || actor.login)),
      action: String(action || ""),
      target_user_id: String(target && target.user_id || ""),
      target_email: _normalizeEmail_(target && (target.email || target.login)),
      details_json: JSON.stringify(details || {}),
      created_at: _nowIso_()
    });
  } catch (_) {}
}

/* ========================= Users admin endpoints ========================= */

function _listUsers_(req, ctx) {
  const users = _getAll_("USERS").map(_publicUser_).sort(function (a, b) {
    if (a.role === "OWNER") return -1;
    if (b.role === "OWNER") return 1;
    return String(a.email).localeCompare(String(b.email), "pt-BR");
  });
  return { ok: true, users: users, count: users.length };
}

function _upsertUser_(req, ctx) {
  const p = req.user || req;
  const email = _normalizeEmail_(p.email);
  const requestedId = String(p.user_id || "").trim();
  const role = String(p.role || "USER").trim().toUpperCase();
  if (!_isValidEmail_(email)) throw new Error("Informe um e-mail válido");
  if (["ADMIN", "EDITOR", "USER"].indexOf(role) === -1) throw new Error("Função inválida");
  if (email === PROFILE_OWNER_EMAIL) throw new Error("O acesso do proprietário não pode ser alterado");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let saved = null;
  let existing = null;
  try {
    if (requestedId) existing = _getUserById_(requestedId);
    const sameEmail = _getUserByEmail_(email);
    if (sameEmail && (!existing || sameEmail.user_id !== existing.user_id)) {
      throw new Error("Este e-mail já está cadastrado");
    }
    if (!existing) existing = sameEmail;
    if (existing && _normalizeEmail_(existing.email || existing.login) === PROFILE_OWNER_EMAIL) {
      throw new Error("O acesso do proprietário não pode ser alterado");
    }

    const now = _nowIso_();
    const active = p.active === undefined
      ? String(existing && existing.active || "TRUE").toUpperCase() !== "FALSE"
      : !(p.active === false || String(p.active).toUpperCase() === "FALSE");
    const changedAccess = !existing || _normalizeEmail_(existing.email || existing.login) !== email ||
      _normalizeRole_(existing.role) !== role ||
      (String(existing.active || "TRUE").toUpperCase() === "TRUE") !== active;
    const authVersion = existing
      ? Math.max(1, Number(existing.auth_version || "1")) + (changedAccess ? 1 : 0)
      : 1;
    const row = Object.assign({}, existing || {}, {
      user_id: existing ? existing.user_id : _uuid_(),
      login: email,
      password_hash: "",
      role: role,
      active: active ? "TRUE" : "FALSE",
      last_login_at: existing ? String(existing.last_login_at || "") : "",
      created_at: existing ? String(existing.created_at || now) : now,
      updated_at: now,
      email: email,
      auth_version: String(authVersion),
      invited_by: existing ? String(existing.invited_by || ctx.user.email) : String(ctx.user.email || ""),
      invited_at: existing ? String(existing.invited_at || now) : now
    });

    const sheet = _sheet_("USERS");
    const idx = existing ? _findRowByKey_(sheet, "user_id", existing.user_id) : { rowNumber: 0 };
    if (idx.rowNumber) _updateObjectRow_(sheet, idx.rowNumber, row);
    else _appendObjectRow_(sheet, row);
    if (existing && changedAccess) _revokeAllSessionsByUser_(existing.user_id);
    saved = _publicUser_(row);
  } finally {
    lock.releaseLock();
  }

  _auditAuth_(ctx.user, existing ? "USER_UPDATED" : "USER_CREATED", saved, {
    role: saved.role,
    active: saved.active
  });
  return { ok: true, user: saved };
}

function _revokeUserSessions_(req, ctx) {
  const p = req.user || req;
  const target = String(p.user_id || "").trim()
    ? _getUserById_(String(p.user_id).trim())
    : _getUserByEmail_(_normalizeEmail_(p.email));
  if (!target) throw new Error("Usuário não encontrado");
  if (_normalizeEmail_(target.email || target.login) === PROFILE_OWNER_EMAIL) {
    throw new Error("As sessões do proprietário não podem ser revogadas por esta tela");
  }
  _revokeAllSessionsByUser_(target.user_id);
  _auditAuth_(ctx.user, "SESSIONS_REVOKED", target, {});
  return { ok: true, user_id: target.user_id };
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
  const revokedTokenHashes = [];
  const colTokenHash = headers.indexOf("token_hash") + 1;
  for (var i = 0; i < values.length; i++) {
    const rowUser = String(values[i][colUser - 1] || "");
    if (rowUser === userId) {
      const tokenHash = colTokenHash > 0 ? String(values[i][colTokenHash - 1] || "") : "";
      if (tokenHash) revokedTokenHashes.push(tokenHash);
      values[i][colRevoked - 1] = "TRUE";
      changed = true;
    }
  }
  if (changed) {
    rng.setValues(values);
    revokedTokenHashes.forEach(_removeAuthCacheByHash_);
  }
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
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = _serializeSheetCell_(row[c], headers[c]);
    return obj;
  });

  _rowsRuntimeCache[sheetName] = rows;
  _writeSheetCache_(sheetName, rows);
  return rows;
}

function _appendRow_(sheetName, rowArray) {
  const sh = _sheet_(sheetName);
  if (sheetName === "SESSIONS") {
    _writeSessionRow_(sh, rowArray);
  } else {
    sh.getRange(sh.getLastRow() + 1, 1, 1, rowArray.length).setValues([rowArray]);
  }
  _invalidateSheetCache_(sheetName);
}

function _writeSessionRow_(sheet, rowArray) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Não foi possível registrar a sessão agora. Tente novamente.");
  try {
    const reusableRow = _takeReusableSessionRow_(sheet);
    sheet.getRange(reusableRow || sheet.getLastRow() + 1, 1, 1, rowArray.length).setValues([rowArray]);
  } finally {
    lock.releaseLock();
  }
}

function _takeReusableSessionRow_(sheet) {
  const cache = CacheService.getScriptCache();
  const cacheKey = PROFILE_CACHE_PREFIX + "sessions:reusable-rows";
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  let state = null;

  try { state = JSON.parse(cache.get(cacheKey) || "null"); } catch (_) { state = null; }
  if (!state || !Array.isArray(state.rows) || now - Number(state.refreshedAt || 0) > 6 * 60 * 60 * 1000) {
    const headers = _headers_(sheet);
    const expiresColumn = headers.indexOf("expires_at") + 1;
    const rows = [];
    const lastRow = sheet.getLastRow();

    if (expiresColumn > 0 && lastRow >= 2) {
      const expirations = sheet.getRange(2, expiresColumn, lastRow - 1, 1).getValues();
      for (var i = 0; i < expirations.length; i++) {
        if (_sessionExpiryMillis_(expirations[i][0]) <= cutoff && rows.length < 5000) rows.push(i + 2);
      }
    }
    state = { refreshedAt: now, rows: rows };
  }

  const expiresColumn = _headers_(sheet).indexOf("expires_at") + 1;
  let selectedRow = 0;
  while (expiresColumn > 0 && state.rows.length) {
    const candidate = Number(state.rows.shift());
    if (candidate < 2 || candidate > sheet.getLastRow()) continue;
    const expiration = sheet.getRange(candidate, expiresColumn, 1, 1).getValue();
    if (_sessionExpiryMillis_(expiration) <= cutoff) {
      selectedRow = candidate;
      break;
    }
  }

  try { cache.put(cacheKey, JSON.stringify(state), 21600); } catch (_) {}
  return selectedRow;
}

function _sessionExpiryMillis_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  const text = String(value || "").trim();
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const isoMillis = Date.parse(text);
    return isNaN(isoMillis) ? Number.POSITIVE_INFINITY : isoMillis;
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return Number.POSITIVE_INFINITY;
  const parsed = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0)
  );
  return isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
}

function _appendObjectRow_(sheet, obj) {
  const headers = _headers_(sheet);
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ""));
  if (sheet.getName() === "SESSIONS") _writeSessionRow_(sheet, row);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  _invalidateSheetCache_(sheet.getName());
}

function _updateObjectRow_(sheet, rowNumber, obj) {
  const headers = _headers_(sheet);
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ""));
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
  _invalidateSheetCache_(sheet.getName());
}

function _updateObjectFields_(sheet, rowNumber, obj, fields) {
  const headers = _headers_(sheet);
  const columns = (fields || []).map(field => headers.indexOf(field))
    .filter(index => index >= 0)
    .sort((a, b) => a - b);
  if (!columns.length) return;

  const groups = [];
  columns.forEach(index => {
    const last = groups[groups.length - 1];
    if (last && index === last[last.length - 1] + 1) last.push(index);
    else groups.push([index]);
  });

  groups.forEach(group => {
    const values = group.map(index => {
      const header = headers[index];
      return obj[header] !== undefined ? obj[header] : "";
    });
    sheet.getRange(rowNumber, group[0] + 1, 1, group.length).setValues([values]);
  });
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

function _authCacheKey_(token) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token || ""), Utilities.Charset.UTF_8);
  return PROFILE_CACHE_PREFIX + "auth:" + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
}

function _readAuthCache_(token) {
  try {
    const value = CacheService.getScriptCache().get(_authCacheKey_(token));
    if (!value) return null;
    const cached = JSON.parse(value);
    if (!cached || !cached.session || !cached.user) return null;
    if (_isTruthy_(cached.session.revoked)) return null;
    const expiresAt = new Date(cached.session.expires_at).getTime();
    if (!isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    if (String(cached.user.active || "").toUpperCase() !== "TRUE") return null;
    return cached;
  } catch (_) {
    return null;
  }
}

function _writeAuthCache_(token, session, user) {
  try {
    CacheService.getScriptCache().put(
      _authCacheKey_(token),
      JSON.stringify({ session: session, user: user }),
      PROFILE_SESSION_CACHE_SECONDS
    );
  } catch (_) {}
}

function _removeAuthCache_(token) {
  try { CacheService.getScriptCache().remove(_authCacheKey_(token)); } catch (_) {}
}

function _removeAuthCacheByHash_(tokenHash) {
  try { CacheService.getScriptCache().remove(PROFILE_CACHE_PREFIX + "auth:" + String(tokenHash || "")); } catch (_) {}
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

function _findRowByKeyText_(sheet, keyHeader, keyValue) {
  const headers = _headers_(sheet);
  const keyCol = headers.indexOf(keyHeader) + 1;
  const lastRow = sheet.getLastRow();
  if (keyCol <= 0) throw new Error("Missing key column: " + keyHeader);
  if (lastRow < 2 || keyValue === undefined || keyValue === null || keyValue === "") {
    return { rowNumber: 0, row: null };
  }

  const match = sheet.getRange(2, keyCol, lastRow - 1, 1)
    .createTextFinder(String(keyValue))
    .matchEntireCell(true)
    .matchCase(true)
    .findNext();
  if (!match) return { rowNumber: 0, row: null };
  const rowNumber = match.getRow();
  return { rowNumber: rowNumber, row: _rowToObj_(sheet, rowNumber) };
}

function _rowToObj_(sheet, rowNumber) {
  const headers = _headers_(sheet);
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const obj = {};
  for (var i = 0; i < headers.length; i++) obj[headers[i]] = _serializeSheetCell_(row[i], headers[i]);
  return obj;
}

/* ========================= Domain helpers ========================= */

function _getStudentById_(studentId) {
  const targetId = String(studentId || "");
  return _getAll_("STUDENTS").find(row => String(row.student_id || "") === targetId) || null;
}

function _getUserByLogin_(login) {
  const target = _normalizeEmail_(login);
  const rows = _getAll_("USERS");
  return rows.find(function (row) {
    return _normalizeEmail_(row.login) === target;
  }) || null;
}

function _getUserByEmail_(email) {
  const target = _normalizeEmail_(email);
  if (!target) return null;
  const rows = _getAll_("USERS");
  return rows.find(function (row) {
    return _normalizeEmail_(row.email || row.login) === target;
  }) || null;
}

function _getUserById_(userId) {
  const rows = _getAll_("USERS");
  return rows.find(r => (r.user_id || "") === userId) || null;
}

function _getSessionByToken_(token) {
  const sh = _sheet_("SESSIONS");
  const headers = _headers_(sh);
  const key = headers.indexOf("token_hash") !== -1 ? "token_hash" : "session_token";
  const value = key === "token_hash" ? _sessionTokenHash_(token) : token;
  const idx = _findRowByKeyText_(sh, key, value);
  return idx.rowNumber ? idx.row : null;
}

function _revokeSession_(token) {
  const sh = _sheet_("SESSIONS");
  const headers = _headers_(sh);
  const key = headers.indexOf("token_hash") !== -1 ? "token_hash" : "session_token";
  const value = key === "token_hash" ? _sessionTokenHash_(token) : token;
  const idx = _findRowByKeyText_(sh, key, value);
  if (!idx.rowNumber) return;

  idx.row.revoked = "TRUE";
  _updateObjectRow_(sh, idx.rowNumber, idx.row);
  _removeAuthCache_(token);
}

function _updateUserLastLogin_(userId) {
  const sh = _sheet_("USERS");
  const idx = _findRowByKey_(sh, "user_id", userId);
  if (!idx.rowNumber) return;

  const now = _nowIso_();
  _updateObjectFields_(sh, idx.rowNumber, { last_login_at: now, updated_at: now }, [
    "last_login_at", "updated_at"
  ]);
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

function _normalizeStudentDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) return "";

  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(year, month - 1, day, 12, 0, 0);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return match[1] + "-" + match[2] + "-" + match[3];
    }
    return "";
  }

  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return _normalizeStudentDate_(match[3] + "-" + match[2] + "-" + match[1]);

  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return "";
  return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function _serializeSheetCell_(value, header) {
  if (value === undefined || value === null || value === "") return "";
  if (!(value instanceof Date) || isNaN(value.getTime())) return String(value);
  const dateOnly = header === "birth_date" || header === "date";
  return Utilities.formatDate(
    value,
    Session.getScriptTimeZone(),
    dateOnly ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss"
  );
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
