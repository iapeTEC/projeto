(function () {
  const PROJECTS = Object.freeze([
    'Monitoria Escolar', 'Residencial Feminino', 'Academia', 'Capelania', 'Coral',
    'e-Class', 'Enfermaria', 'Esporte', 'Hotelaria', 'Jardim', 'Audiovisual',
    'Marketing', 'Pastoral', 'Restaurante', 'Secretaria', 'R.H.', 'Contabilidade',
    'Projeto', 'Residencial Masculino', 'Coordenação Pedagógica'
  ]);
  const CACHE_PREFIX = 'attendance:v3:';
  const inflight = new Map();
  const REQUEST_TIMEOUT_MS = 90000;
  const SLOW_REQUEST_NOTICE_MS = 25000;

  function apiUrl() {
    const value = window.ATTENDANCE_APP_CONFIG && window.ATTENDANCE_APP_CONFIG.API_URL;
    if (!value) throw new Error('URL da API de frequência não configurada.');
    return value;
  }

  function currentSession() {
    const token = window.Api && window.Api.getToken();
    const user = window.Api && window.Api.getUser();
    if (!token || !user) {
      const error = new Error('Sessão ausente. Entre novamente para continuar.');
      error.code = 401;
      if (window.Api) window.Api.handleAuthFailure(error);
      throw error;
    }
    return { token: token, identity: user.user_id || user.email || 'anonymous' };
  }

  function cacheKey(params) {
    const session = currentSession();
    return String(session.identity) + ':' + new URLSearchParams(params || {}).toString();
  }

  function readCache(key, maxAge) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
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
      sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), value: value }));
    } catch (error) {}
  }

  function clearCache() {
    try {
      Object.keys(sessionStorage).forEach(function (key) {
        if (key.indexOf('attendance:') === 0) sessionStorage.removeItem(key);
      });
    } catch (error) {}
  }

  function responseError(message, code) {
    const error = new Error(message || 'Não foi possível concluir a solicitação.');
    if (code !== undefined && code !== null && code !== '') error.code = Number(code) || code;
    return error;
  }

  function isTransientReadError(error) {
    const code = Number(error && error.code);
    if (code === 404 || code === 408 || code === 429 || code >= 500) return true;
    const message = String(error && error.message || '').toLowerCase();
    return /failed to fetch|networkerror|load failed|resposta inv[aá]lida|deploy do apps script/.test(message);
  }

  function retryDelay() {
    return new Promise(function (resolve) { setTimeout(resolve, 350); });
  }

  async function request(body, message) {
    const controller = new AbortController();
    const token = window.Loading ? window.Loading.start(message || 'Consultando dados…') : null;
    const slowNotice = setTimeout(function () {
      if (token && window.Loading) {
        window.Loading.update(token, 'O Google está respondendo mais devagar. Continuamos tentando…');
      }
    }, SLOW_REQUEST_NOTICE_MS);
    const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl(), {
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
        throw responseError(data && (data.message || data.error) ||
          'A API de frequência respondeu com HTTP ' + response.status + '. Confira o deploy do Apps Script.', response.status);
      }
      if (!data) throw responseError('O servidor devolveu uma resposta inválida. Confira o deploy do Apps Script.');
      if (data.status !== 'success' && data.status !== 'ok' && data.ok !== true) {
        throw responseError(data.message || data.error || 'Não foi possível concluir a solicitação.', data.code);
      }
      if (data.user && window.Api && !window.Api.acceptSessionUser(data.user, data.expires_at)) {
        throw responseError('A sessão devolvida pela API não corresponde ao usuário atual.', 401);
      }
      return data;
    } catch (error) {
      let finalError = error;
      if (error && error.name === 'AbortError') {
        finalError = responseError('O Google Apps Script não respondeu em 90 segundos. Aguarde um instante e tente novamente.');
      }
      if (window.Api) window.Api.handleAuthFailure(finalError);
      throw finalError;
    } finally {
      clearTimeout(timer);
      clearTimeout(slowNotice);
      if (token && window.Loading) window.Loading.stop(token);
    }
  }

  function get(params, options) {
    const opts = options || {};
    const key = cacheKey(params);
    const cached = !opts.force && opts.cacheMs ? readCache(key, opts.cacheMs) : null;
    if (cached) return Promise.resolve(cached);
    if (inflight.has(key)) return inflight.get(key);

    const session = currentSession();
    const body = Object.assign({}, params || {}, { token: session.token });
    const execute = function () { return request(body, opts.message); };
    const promise = execute().catch(function (error) {
      if (!isTransientReadError(error)) throw error;
      return retryDelay().then(execute);
    }).then(function (data) {
      if (opts.cacheMs) writeCache(key, data);
      return data;
    }).finally(function () { inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  }

  function post(action, payload, options) {
    const session = currentSession();
    const body = Object.assign({}, payload || {}, { acao: action, token: session.token });
    return request(body, options && options.message || 'Salvando dados…').then(function (data) {
      clearCache();
      return data;
    });
  }

  function getProjects(options) {
    return get({ acao: 'listaProjetos' }, {
      cacheMs: 5 * 60 * 1000,
      force: options && options.force,
      message: 'Atualizando projetos…'
    });
  }

  function getRoster(project, options) {
    return get({ acao: 'rosterProjeto', projeto: project }, {
      cacheMs: 5 * 60 * 1000,
      force: options && options.force,
      message: 'Buscando alunos de ' + project + '…'
    });
  }

  function getDashboard(filters) {
    return get(Object.assign({ acao: 'dashboard' }, filters || {}), {
      message: 'Montando o dashboard…'
    });
  }

  function registerAttendance(payload) {
    return post('registrarFrequencia', payload, { message: 'Salvando a presença…' });
  }

  window.AttendanceApi = {
    PROJECTS: PROJECTS,
    getProjects: getProjects,
    getRoster: getRoster,
    getDashboard: getDashboard,
    registerAttendance: registerAttendance,
    clearCache: clearCache
  };
})();
