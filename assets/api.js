(function () {
  const inflight = new Map();
  const READ_CACHE_MS = Object.freeze({
    listSectors: 10 * 60 * 1000,
    listScholarshipTypes: 10 * 60 * 1000,
    listCompetencies: 10 * 60 * 1000,
    listStudents: 60 * 1000,
    getHomeOverview: 60 * 1000,
    getStudentDirectory: 60 * 1000,
    getEditorBootstrap: 60 * 1000,
    getStudentProfile: 45 * 1000,
    getStudentReport: 45 * 1000,
    getSponsorReport: 45 * 1000
  });

  function getConfig() {
    if (!window.APP_CONFIG || !window.APP_CONFIG.API_URL) {
      throw new Error('APP_CONFIG não definido (assets/config.js).');
    }
    return window.APP_CONFIG;
  }

  function getToken() {
    const expiresAt = localStorage.getItem('session_expires_at');
    if (expiresAt) {
      const expires = Date.parse(expiresAt);
      if (Number.isFinite(expires) && expires <= Date.now()) {
        clearSession();
        return '';
      }
    }
    return localStorage.getItem('session_token') || '';
  }

  function getUser() {
    const raw = localStorage.getItem('session_user');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (error) { return null; }
  }

  function setSession(token, user, expiresAt) {
    localStorage.setItem('session_token', token || '');
    localStorage.setItem('session_user', JSON.stringify(user || {}));
    if (expiresAt) localStorage.setItem('session_expires_at', expiresAt);
    clearApiCache();
  }

  function clearSession() {
    localStorage.removeItem('session_token');
    localStorage.removeItem('session_user');
    localStorage.removeItem('session_expires_at');
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
    return 'profile-api:v2:' + String(user && user.login || 'anonymous') + ':' + action + ':' + stableStringify(payload || {});
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
      sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
    } catch (error) {}
  }

  function clearApiCache() {
    try {
      Object.keys(sessionStorage).forEach(function (key) {
        if (key.indexOf('profile-api:v2:') === 0) sessionStorage.removeItem(key);
      });
    } catch (error) {}
  }

  function requestLabel(action) {
    const labels = {
      login: 'Entrando…', logout: 'Encerrando sessão…', listStudents: 'Buscando alunos…',
      listSectors: 'Carregando setores…', listScholarshipTypes: 'Carregando bolsas…',
      listCompetencies: 'Carregando competências…', getStudentReport: 'Montando o perfil…',
      getSponsorReport: 'Montando o relatório…', upsertStudent: 'Salvando aluno…',
      getHomeOverview: 'Montando a visão acadêmica…', getStudentDirectory: 'Organizando o diretório de alunos…',
      getEditorBootstrap: 'Preparando a gestão acadêmica…', getStudentProfile: 'Montando o perfil acadêmico…',
      createEvaluation: 'Salvando avaliação…', setStudentSector: 'Atualizando setor…'
    };
    return labels[action] || 'Processando solicitação…';
  }

  async function fetchApi(action, payload) {
    const config = getConfig();
    const body = Object.assign({}, payload || {}, { action: action });
    if (action !== 'login') body.token = body.token || getToken();

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 45000);
    const loadingToken = window.Loading ? window.Loading.start(requestLabel(action)) : null;
    try {
      const response = await fetch(config.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error('Resposta inesperada do servidor. Verifique o deploy do Apps Script.');
      }
      if (!response.ok) throw new Error('Falha HTTP ' + response.status + '.');
      if (!data || data.ok !== true) {
        throw new Error(data && data.error ? data.error : 'Erro desconhecido.');
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('O servidor demorou mais de 45 segundos. Tente novamente.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
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

    const promise = fetchApi(action, payload).then(function (data) {
      if (cacheMs) writeCache(key, data);
      else if (action !== 'login' && action !== 'logout') clearApiCache();
      return data;
    }).finally(function () { inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const parts = String(iso).slice(0, 10).split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(iso);
  }

  function esc(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  window.Api = {
    apiPost, getToken, getUser, setSession, clearSession, clearApiCache, fmtDate, esc
  };
})();
