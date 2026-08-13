(function () {
  const inflight = new Map();
  const REQUEST_TIMEOUT_MS = 90000;
  const SLOW_REQUEST_NOTICE_MS = 25000;
  const SESSION_KEYS = Object.freeze({
    token: 'session_token',
    user: 'session_user',
    expiresAt: 'session_expires_at'
  });
  const PUBLIC_ACTIONS = new Set(['ping', 'requestLoginCode', 'verifyLoginCode']);
  const READ_CACHE_MS = Object.freeze({
    listSectors: 10 * 60 * 1000,
    listScholarshipTypes: 10 * 60 * 1000,
    listCompetencies: 10 * 60 * 1000,
    listStudents: 60 * 1000,
    listUsers: 30 * 1000,
    getHomeOverview: 60 * 1000,
    getStudentDirectory: 60 * 1000,
    getEditorBootstrap: 60 * 1000,
    getStudentProfile: 45 * 1000,
    getStudentReport: 45 * 1000,
    getSponsorReport: 45 * 1000
  });

  function getConfig() {
    if (!window.PROFILE_APP_CONFIG || !window.PROFILE_APP_CONFIG.API_URL) {
      throw new Error('PROFILE_APP_CONFIG não definido (assets/config.js).');
    }
    return window.PROFILE_APP_CONFIG;
  }

  function clearLegacySession() {
    try {
      Object.keys(SESSION_KEYS).forEach(function (name) {
        localStorage.removeItem(SESSION_KEYS[name]);
      });
    } catch (error) {}
  }

  function sessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (error) { return null; }
  }

  function sessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (error) {
      throw new Error('Não foi possível salvar a sessão neste navegador.');
    }
  }

  function sessionRemove(key) {
    try { sessionStorage.removeItem(key); } catch (error) {}
  }

  function expirationTime(value) {
    if (!value) return NaN;
    if (/^\d+$/.test(String(value))) {
      const numeric = Number(value);
      return numeric < 100000000000 ? numeric * 1000 : numeric;
    }
    return Date.parse(value);
  }

  function getSessionExpiresAt() {
    return sessionGet(SESSION_KEYS.expiresAt) || '';
  }

  function getToken() {
    const expiresAt = getSessionExpiresAt();
    const expires = expirationTime(expiresAt);
    if (expiresAt && Number.isFinite(expires) && expires <= Date.now()) {
      clearSession();
      return '';
    }
    return sessionGet(SESSION_KEYS.token) || '';
  }

  function normalizeUser(user) {
    if (!user || typeof user !== 'object') return null;
    const email = String(user.email || '').trim().toLowerCase();
    const role = String(user.role || '').trim().toUpperCase();
    if (!email || !role) return null;
    return Object.assign({}, user, { email: email, role: role });
  }

  function getUser() {
    const raw = sessionGet(SESSION_KEYS.user);
    if (!raw) return null;
    try {
      const user = normalizeUser(JSON.parse(raw));
      if (!user) clearSession();
      return user;
    } catch (error) {
      clearSession();
      return null;
    }
  }

  function setSession(token, user, expiresAt) {
    const normalizedUser = normalizeUser(user);
    if (!token || !normalizedUser) throw new Error('O servidor não devolveu uma sessão válida.');
    sessionSet(SESSION_KEYS.token, String(token));
    sessionSet(SESSION_KEYS.user, JSON.stringify(normalizedUser));
    if (expiresAt) sessionSet(SESSION_KEYS.expiresAt, String(expiresAt));
    else sessionRemove(SESSION_KEYS.expiresAt);
    clearApiCache();
    return normalizedUser;
  }

  function clearSession() {
    sessionRemove(SESSION_KEYS.token);
    sessionRemove(SESSION_KEYS.user);
    sessionRemove(SESSION_KEYS.expiresAt);
    clearApiCache();
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + stableStringify(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function cacheKey(action, payload) {
    const user = getUser();
    const identity = user && (user.user_id || user.email) || 'anonymous';
    return 'profile-api:v6:' + String(identity) + ':' + action + ':' + stableStringify(payload || {});
  }

  function readCache(key, maxAge) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || Date.now() - Number(entry.savedAt || 0) > maxAge) return null;
      return entry.value;
    } catch (error) {
      return null;
    }
  }

  function writeCache(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value: value }));
    } catch (error) {}
  }

  function clearApiCache() {
    try {
      Object.keys(sessionStorage).forEach(function (key) {
        if (key.indexOf('profile-api:') === 0 || key.indexOf('attendance:') === 0) {
          sessionStorage.removeItem(key);
        }
      });
    } catch (error) {}
  }

  function requestLabel(action) {
    const labels = {
      requestLoginCode: 'Enviando seu código…', verifyLoginCode: 'Validando seu acesso…',
      me: 'Confirmando sua sessão…', logout: 'Encerrando sessão…', listUsers: 'Carregando acessos…',
      upsertUser: 'Salvando acesso…', revokeUserSessions: 'Revogando sessões…',
      listStudents: 'Buscando alunos…', listSectors: 'Carregando setores…',
      listScholarshipTypes: 'Carregando bolsas…', listCompetencies: 'Carregando competências…',
      getStudentReport: 'Montando o perfil…', getSponsorReport: 'Montando o relatório…',
      upsertStudent: 'Salvando aluno…', getHomeOverview: 'Montando a visão acadêmica…',
      getStudentDirectory: 'Organizando o diretório de alunos…',
      getEditorBootstrap: 'Preparando a gestão acadêmica…', getStudentProfile: 'Montando o perfil acadêmico…',
      createEvaluation: 'Salvando avaliação…', setStudentSector: 'Atualizando setor…'
    };
    return labels[action] || 'Processando solicitação…';
  }

  function apiError(message, code) {
    const error = new Error(message || 'Não foi possível concluir a solicitação.');
    if (code !== undefined && code !== null && code !== '') error.code = Number(code) || code;
    return error;
  }

  function isTransientReadError(error) {
    const code = Number(error && error.code);
    if (code === 404 || code === 408 || code === 429 || code >= 500) return true;
    const message = String(error && error.message || '').toLowerCase();
    return /failed to fetch|networkerror|load failed|resposta inesperada|deploy do apps script/.test(message);
  }

  function retryDelay() {
    return new Promise(function (resolve) { setTimeout(resolve, 350); });
  }

  function isSessionError(error) {
    if (!error) return false;
    if (Number(error.code) === 401) return true;
    const message = String(error.message || error.error || '').toLowerCase();
    return /(?:sess[aã]o|session|token).*(?:inv[aá]lid|expir|revog|ausente|missing)|(?:invalid|expired|revoked|missing).*(?:session|token)|usu[aá]rio inativo|user inactive/.test(message);
  }

  function currentPage() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file + window.location.search + window.location.hash;
  }

  function handleAuthFailure(error, options) {
    const opts = options || {};
    if (!isSessionError(error)) return false;
    clearSession();
    if (opts.redirect === false || /(?:^|\/)login\.html$/.test(window.location.pathname)) return true;
    try { sessionStorage.setItem('ui_notice', 'Sua sessão expirou. Entre novamente para continuar.'); } catch (storageError) {}
    window.location.replace('login.html?reason=session-expired&next=' + encodeURIComponent(currentPage()));
    return true;
  }

  async function fetchApi(action, payload, options) {
    const opts = options || {};
    const config = getConfig();
    const body = Object.assign({}, payload || {}, { action: action });
    if (!PUBLIC_ACTIONS.has(action)) body.token = body.token || getToken();

    const controller = new AbortController();
    const loadingToken = window.Loading ? window.Loading.start(requestLabel(action)) : null;
    const slowNotice = setTimeout(function () {
      if (loadingToken && window.Loading) {
        window.Loading.update(loadingToken, 'O Google está respondendo mais devagar. Continuamos tentando…');
      }
    }, SLOW_REQUEST_NOTICE_MS);
    const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(config.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch (parseError) {}

      if (!response.ok) {
        throw apiError(data && (data.error || data.message) ||
          'A API respondeu com HTTP ' + response.status + '. Confira o deploy do Apps Script.', response.status);
      }
      if (!data) throw apiError('Resposta inesperada do servidor. Verifique o deploy do Apps Script.');
      if (data.ok !== true) throw apiError(data.error || data.message || 'Erro desconhecido.', data.code);
      return data;
    } catch (error) {
      let finalError = error;
      if (error && error.name === 'AbortError') {
        finalError = apiError('O Google Apps Script não respondeu em 90 segundos. Aguarde um instante e tente novamente.');
      }
      if (!PUBLIC_ACTIONS.has(action) && !opts.skipAuthRedirect) handleAuthFailure(finalError);
      throw finalError;
    } finally {
      clearTimeout(timer);
      clearTimeout(slowNotice);
      if (loadingToken && window.Loading) window.Loading.stop(loadingToken);
    }
  }

  function apiPost(action, payload, options) {
    const opts = options || {};
    const key = cacheKey(action, payload);
    const cacheMs = opts.noCache ? 0 : Number(READ_CACHE_MS[action] || 0);
    const cached = cacheMs ? readCache(key, cacheMs) : null;
    if (cached) return Promise.resolve(cached);
    if (inflight.has(key)) return inflight.get(key);

    const execute = function () { return fetchApi(action, payload, opts); };
    const promise = execute().catch(function (error) {
      if (!cacheMs || opts.noRetry || !isTransientReadError(error)) throw error;
      return retryDelay().then(execute);
    }).then(function (data) {
      if (cacheMs) writeCache(key, data);
      else if (!PUBLIC_ACTIONS.has(action) && action !== 'me' && action !== 'logout') clearApiCache();
      return data;
    }).finally(function () { inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  }

  async function validateSession(options) {
    if (!getToken() || !getUser()) return null;
    try {
      const data = await apiPost('me', {}, { noCache: true, skipAuthRedirect: options && options.redirect === false });
      const currentToken = getToken();
      const expiresAt = getSessionExpiresAt();
      return setSession(currentToken, data.user, data.expires_at || expiresAt);
    } catch (error) {
      handleAuthFailure(error, options);
      throw error;
    }
  }

  function acceptSessionUser(user, expiresAt) {
    const token = getToken();
    const current = getUser();
    if (!token || !current) return null;
    const normalized = normalizeUser(user);
    if (!normalized || (current.user_id && normalized.user_id && current.user_id !== normalized.user_id)) {
      clearSession();
      return null;
    }
    return setSession(token, normalized, expiresAt || getSessionExpiresAt());
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const parts = String(iso).slice(0, 10).split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(iso);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  clearLegacySession();

  window.Api = {
    apiPost: apiPost,
    getToken: getToken,
    getUser: getUser,
    getSessionExpiresAt: getSessionExpiresAt,
    setSession: setSession,
    clearSession: clearSession,
    clearApiCache: clearApiCache,
    validateSession: validateSession,
    acceptSessionUser: acceptSessionUser,
    isSessionError: isSessionError,
    handleAuthFailure: handleAuthFailure,
    fmtDate: fmtDate,
    esc: esc
  };
})();
