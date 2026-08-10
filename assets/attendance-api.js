(function () {
  const PROJECTS = Object.freeze([
    'Monitoria Escolar', 'Residencial Feminino', 'Academia', 'Capelania', 'Coral',
    'e-Class', 'Enfermaria', 'Esporte', 'Hotelaria', 'Jardim', 'Audiovisual',
    'Marketing', 'Pastoral', 'Restaurante', 'Secretaria', 'R.H.', 'Contabilidade',
    'Projeto', 'Residencial Masculino', 'Coordenação Pedagógica'
  ]);
  const CACHE_PREFIX = 'attendance:v2:';
  const inflight = new Map();

  function apiUrl() {
    const value = window.APP_CONFIG && window.APP_CONFIG.API_URL;
    if (!value) throw new Error('URL do Apps Script não configurada.');
    return value;
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
      sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }));
    } catch (error) {}
  }

  async function request(url, options, message) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 45000);
    const token = window.Loading ? window.Loading.start(message || 'Consultando dados…') : null;

    try {
      const response = await fetch(url, Object.assign({
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal
      }, options || {}));
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error('O servidor devolveu uma resposta inválida. Confira o deploy do Apps Script.');
      }
      if (!response.ok) throw new Error('Falha HTTP ' + response.status + '.');
      if (!data || (data.status !== 'success' && data.status !== 'ok')) {
        throw new Error((data && data.message) || 'Não foi possível concluir a solicitação.');
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('O servidor demorou mais de 45 segundos. Tente novamente.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (token && window.Loading) window.Loading.stop(token);
    }
  }

  function get(params, options) {
    const opts = options || {};
    const query = new URLSearchParams(params || {});
    const key = query.toString();
    const cached = !opts.force && opts.cacheMs ? readCache(key, opts.cacheMs) : null;
    if (cached) return Promise.resolve(cached);
    if (inflight.has(key)) return inflight.get(key);

    const promise = request(apiUrl() + '?' + key, null, opts.message)
      .then(function (data) {
        if (opts.cacheMs) writeCache(key, data);
        return data;
      })
      .finally(function () { inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  }

  function post(action, payload, options) {
    const body = Object.assign({}, payload || {}, { acao: action });
    return request(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }, (options && options.message) || 'Salvando dados…');
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
    PROJECTS,
    getProjects,
    getRoster,
    getDashboard,
    registerAttendance
  };
})();
