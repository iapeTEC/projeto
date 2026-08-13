(function () {
  const user = window.UI.requireCapability(window.UI.CAPABILITIES.VIEW_ATTENDANCE);
  if (!user) return;
  window.UI.applyCapabilities(document, user);
  window.UI.mountAttendanceAccount('attendanceAccount', user);

  const elements = {
    start: document.getElementById('start-date'),
    end: document.getElementById('end-date'),
    preset: document.getElementById('period-preset'),
    project: document.getElementById('project-filter'),
    threshold: document.getElementById('absence-threshold'),
    refresh: document.getElementById('refresh-dashboard'),
    print: document.getElementById('print-absences'),
    status: document.getElementById('dashboard-status'),
    attentionList: document.getElementById('attention-list'),
    attentionCount: document.getElementById('attention-count'),
    attentionHint: document.getElementById('attention-hint'),
    riskSearch: document.getElementById('student-risk-search'),
    sectors: document.getElementById('sector-overview'),
    showAllSectors: document.getElementById('show-all-sectors'),
    observations: document.querySelector('#observations-table tbody'),
    rows: document.querySelector('#rows-table tbody'),
    updated: document.getElementById('last-updated'),
    printArea: document.getElementById('print-area')
  };
  const state = { data: null, allData: null, projects: [], requestNumber: 0 };

  function localIso(date) {
    const value = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return value.toISOString().slice(0, 10);
  }

  function todayIso() {
    return localIso(new Date());
  }

  function offsetDateIso(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localIso(date);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    const parts = String(value || '').slice(0, 10).split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(value || '—');
  }

  function plural(value, singular, pluralForm) {
    return value + ' ' + (value === 1 ? singular : (pluralForm || singular + 's'));
  }

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR').trim();
  }

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
  }

  function setMetric(id, value, suffix) {
    document.getElementById(id).textContent = String(value == null ? 0 : value) + (suffix || '');
  }

  function fillTable(target, rows, columns, message) {
    target.innerHTML = rows.length ? rows.join('') :
      '<tr><td colspan="' + columns + '"><div class="empty">' +
      escapeHtml(message || 'Sem dados no período selecionado.') + '</div></td></tr>';
  }

  function setQueryString() {
    try {
      const params = new URLSearchParams();
      params.set('inicio', elements.start.value);
      params.set('fim', elements.end.value);
      if (elements.project.value) params.set('setor', elements.project.value);
      params.set('minFaltas', elements.threshold.value);
      params.set('periodo', elements.preset.value);
      history.replaceState(null, '', location.pathname + '?' + params.toString());
    } catch (error) {}
  }

  function readInitialQuery() {
    const params = new URLSearchParams(location.search);
    const start = params.get('inicio');
    const end = params.get('fim');
    const project = params.get('setor') || params.get('projeto');
    const threshold = params.get('minFaltas');
    const preset = params.get('periodo');
    if (/^\d{4}-\d{2}-\d{2}$/.test(start || '')) elements.start.value = start;
    if (/^\d{4}-\d{2}-\d{2}$/.test(end || '')) elements.end.value = end;
    if (project) elements.project.dataset.initialValue = project;
    if (['1', '2', '3', '5', '10'].includes(threshold)) elements.threshold.value = threshold;
    if (['7', '30', '90', 'month', 'custom'].includes(preset)) elements.preset.value = preset;
    else if (start || end) elements.preset.value = 'custom';
  }

  function applyPeriodPreset(value) {
    const today = todayIso();
    if (value === 'custom') return;
    elements.end.value = today;
    if (value === 'month') {
      elements.start.value = today.slice(0, 8) + '01';
      return;
    }
    const days = Number(value || 30);
    elements.start.value = offsetDateIso(-(Math.max(days, 1) - 1));
  }

  function fillProjects(projects) {
    const current = elements.project.value || elements.project.dataset.initialValue || '';
    const seen = {};
    elements.project.innerHTML = '<option value="">Todos os setores</option>';
    (projects || []).forEach(function (item) {
      const name = String(item.projeto || item.project || item.group || item || '').trim();
      if (!name || seen[normalize(name)]) return;
      seen[normalize(name)] = true;
      const responsible = String(item.responsavel || item.responsible || '').trim();
      const option = document.createElement('option');
      option.value = name;
      option.textContent = responsible ? name + ' — ' + responsible : name;
      elements.project.appendChild(option);
    });
    if (current) elements.project.value = current;
    delete elements.project.dataset.initialValue;
  }

  function absenceLevel(row) {
    const misses = Number(row.faltas || 0);
    if (misses >= 5 || Number(row.frequenciaPct || 0) < 75) return 'critical';
    if (misses >= 3) return 'warning';
    return 'watch';
  }

  function renderAttention(data) {
    const query = normalize(elements.riskSearch.value);
    const all = data.rankingAlunos || data.ranking || [];
    const visible = all.filter(function (row) {
      return !query || normalize(row.student || row.aluno).includes(query) ||
        normalize(row.group || row.projeto).includes(query);
    });
    elements.attentionCount.textContent = plural(all.length, 'aluno');
    elements.attentionHint.textContent = all.length
      ? 'Mostrando quem tem ' + elements.threshold.value + ' ou mais faltas.'
      : 'Nenhum aluno alcançou o limite selecionado.';
    setMetric('metric-at-risk', all.length);
    document.getElementById('metric-attention-label').textContent = 'Com ' + elements.threshold.value + '+ faltas';

    if (!visible.length) {
      elements.attentionList.innerHTML = '<div class="empty">' + (query
        ? 'Nenhum aluno encontrado nesta busca.'
        : 'Ótima notícia: ninguém atingiu o limite de faltas no período.') + '</div>';
      return;
    }

    elements.attentionList.innerHTML = visible.map(function (row, index) {
      const student = row.student || row.aluno || 'Aluno';
      const group = row.group || row.projeto || 'Sem setor';
      const absences = Number(row.faltas || 0);
      const percent = Number(row.frequenciaPct || 0);
      const streak = Number(row.faltasConsecutivas || 0);
      const dates = (row.datasFalta || []).slice(0, 5);
      const level = absenceLevel(row);
      return '<article class="attention-card attention-' + level + '">' +
        '<div class="attention-rank" aria-label="Posição ' + (index + 1) + '">' + (index + 1) + '</div>' +
        '<div class="student-avatar attention-avatar" aria-hidden="true">' + escapeHtml(initials(student)) + '</div>' +
        '<div class="attention-main"><div class="attention-title-row"><div><h3>' + escapeHtml(student) +
        '</h3><button type="button" class="link-button sector-filter-button" data-project="' + escapeHtml(group) + '">' +
        escapeHtml(group) + '</button></div><span class="absence-count">' + plural(absences, 'falta') + '</span></div>' +
        '<div class="attention-meta"><span><strong>' + percent + '%</strong> de frequência</span>' +
        (streak ? '<span><strong>' + streak + '</strong> falta' + (streak === 1 ? '' : 's') + ' seguida' + (streak === 1 ? '' : 's') + '</span>' : '') +
        '<span>Última falta: <strong>' + escapeHtml(formatDate(row.ultimaFalta)) + '</strong></span>' +
        (row.responsible ? '<span>Responsável: <strong>' + escapeHtml(row.responsible) + '</strong></span>' : '') + '</div>' +
        (dates.length ? '<div class="absence-dates" aria-label="Datas das faltas">' + dates.map(function (date) {
          return '<span>' + escapeHtml(formatDate(date)) + '</span>';
        }).join('') + '</div>' : '') + '</div>' +
        '<div class="attention-actions no-print"><button type="button" class="btn btn-quiet sector-filter-button" data-project="' +
        escapeHtml(group) + '">Ver setor</button><a class="btn btn-primary" href="chamada.html?projeto=' +
        encodeURIComponent(group) + '" data-required-capability="attendance:record">Abrir chamada</a></div></article>';
    }).join('');
    window.UI.applyCapabilities(elements.attentionList, user);
  }

  function projectResponsible(name) {
    const key = normalize(name);
    const match = state.projects.find(function (item) {
      return normalize(item.projeto || item.project || item.group || item) === key;
    });
    return match ? String(match.responsavel || match.responsible || '').trim() : '';
  }

  function renderSectors(data) {
    const selected = elements.project.value;
    const summaries = (data.resumoPorGrupo || []).slice();
    if (!summaries.length) {
      elements.sectors.innerHTML = '<div class="empty">Nenhum lançamento encontrado no período.</div>';
      elements.showAllSectors.classList.toggle('hidden', !selected);
      return;
    }
    elements.sectors.innerHTML = summaries.map(function (row) {
      const name = row.group || row.projeto || 'Sem setor';
      const total = Number(row.total || 0);
      const absences = Number(row.faltas || 0);
      const affected = Number(row.alunosComFalta || 0);
      const percent = Number(row.frequenciaPct || 0);
      const responsible = row.responsible || projectResponsible(name);
      return '<button class="sector-card' + (selected === name ? ' is-selected' : '') + '" type="button" data-project="' +
        escapeHtml(name) + '"><span class="sector-card-top"><span class="project-icon">' +
        escapeHtml(initials(name)) + '</span><span class="sector-chevron" aria-hidden="true">→</span></span>' +
        '<strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(responsible || 'Responsável não informado') + '</small>' +
        '<span class="sector-stats"><b>' + plural(absences, 'falta') + '</b><span>' + plural(affected, 'aluno') + '</span></span>' +
        '<span class="frequency-bar"><i style="width:' + Math.max(0, Math.min(100, percent)) + '%"></i></span>' +
        '<span class="sector-frequency">' + percent + '% de frequência • ' + total + ' lançamentos</span></button>';
    }).join('');
    elements.showAllSectors.classList.toggle('hidden', !selected);
  }

  function renderDetails(data) {
    const observations = (data.observacoes || []).slice(0, 8).map(function (row) {
      return '<tr><td>' + escapeHtml(formatDate(row.date)) + '</td><td><button type="button" class="link-button sector-filter-button" data-project="' +
        escapeHtml(row.group) + '">' + escapeHtml(row.group) + '</button></td><td>' + escapeHtml(row.student) +
        '</td><td class="wrap-cell">' + escapeHtml(row.observation) + '</td></tr>';
    });
    fillTable(elements.observations, observations, 4, 'Nenhuma observação no período.');

    const absenceRows = (data.rows || []).filter(function (row) { return Number(row.present) !== 1; }).slice(0, 20).map(function (row) {
      return '<tr><td>' + escapeHtml(formatDate(row.date)) + '</td><td><button type="button" class="link-button sector-filter-button" data-project="' +
        escapeHtml(row.group) + '">' + escapeHtml(row.group) + '</button></td><td><strong>' + escapeHtml(row.student) +
        '</strong></td><td>' + escapeHtml(row.responsible || '—') + '</td><td class="wrap-cell">' +
        escapeHtml(row.observation || '—') + '</td></tr>';
    });
    fillTable(elements.rows, absenceRows, 5, 'Nenhuma falta no período.');
  }

  function dataForProject(data, project) {
    if (!project) return data;
    const key = normalize(project);
    const summaries = (data.resumoPorGrupo || []).filter(function (row) {
      return normalize(row.group || row.projeto) === key;
    });
    const summary = summaries[0] || {};
    const belongsToProject = function (row) {
      return normalize(row.group || row.projeto) === key;
    };
    return Object.assign({}, data, {
      filter: Object.assign({}, data.filter || {}, { projeto: project }),
      metrics: {
        totalLancamentos: Number(summary.total || 0),
        presentes: Number(summary.presentes || 0),
        faltas: Number(summary.faltas || 0),
        observacoes: Number(summary.observacoes || 0),
        frequenciaPct: Number(summary.frequenciaPct || 0),
        alunosComFalta: Number(summary.alunosComFalta || 0),
        setoresComFalta: Number(summary.faltas || 0) > 0 ? 1 : 0
      },
      resumoPorGrupo: summaries,
      rankingAlunos: (data.rankingAlunos || []).filter(belongsToProject),
      rankingTotal: (data.rankingAlunos || []).filter(belongsToProject).length,
      observacoes: (data.observacoes || []).filter(belongsToProject),
      rows: (data.rows || []).filter(belongsToProject)
    });
  }

  function render(data) {
    state.data = data;
    const metrics = data.metrics || {};
    setMetric('metric-total', Number(metrics.totalLancamentos || 0));
    setMetric('metric-present', Number(metrics.presentes || 0));
    setMetric('metric-absent', Number(metrics.faltas || 0));
    setMetric('metric-percent', Number(metrics.frequenciaPct || 0), '%');
    setMetric('metric-sectors', Number(metrics.setoresComFalta || 0));
    state.projects = data.projects && data.projects.length ? data.projects : state.projects;
    if (state.projects.length) fillProjects(state.projects);
    renderAttention(data);
    renderSectors(data);
    renderDetails(data);
    elements.updated.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setQueryString();
  }

  function showStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = 'status is-visible ' + (type || 'success');
  }

  function filters(extra) {
    return Object.assign({
      start: elements.start.value || todayIso(),
      end: elements.end.value || todayIso(),
      projeto: '',
      minFaltas: elements.threshold.value || '3',
      rankingLimit: '200',
      rows: '1',
      faltas: '1',
      limit: '50'
    }, extra || {});
  }

  function validateDates() {
    if (!elements.start.value || !elements.end.value) {
      showStatus('Informe a data inicial e a data final.', 'error');
      return false;
    }
    if (elements.start.value > elements.end.value) {
      showStatus('A data inicial precisa ser anterior à data final.', 'error');
      return false;
    }
    return true;
  }

  async function loadDashboard() {
    if (!validateDates()) return;
    const currentRequest = ++state.requestNumber;
    elements.status.className = 'status';
    try {
      const data = await Loading.run(function () {
        return AttendanceApi.getDashboard(filters());
      }, { button: elements.refresh, buttonLabel: 'Atualizando…', message: 'Organizando faltas e prioridades…' });
      if (currentRequest === state.requestNumber) {
        state.allData = data;
        render(dataForProject(data, elements.project.value));
      }
    } catch (error) {
      if (currentRequest === state.requestNumber) showStatus(error.message || String(error), 'error');
    }
  }

  function selectProject(project) {
    elements.project.value = project || '';
    elements.riskSearch.value = '';
    if (state.allData) render(dataForProject(state.allData, elements.project.value));
    else loadDashboard();
    document.getElementById('attention-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildPrintReport(data) {
    const ranking = data.rankingAlunos || [];
    const summaries = data.resumoPorGrupo || [];
    const rows = (data.rows || []).filter(function (row) { return Number(row.present) !== 1; });
    const titleProject = elements.project.value ? ' • ' + elements.project.value : ' • Todos os setores';
    let html = '<header class="print-report-header"><p>IAPE • Gestão Estudantil</p><h1>Relatório de faltas</h1><p>Período: ' +
      escapeHtml(formatDate(elements.start.value)) + ' a ' + escapeHtml(formatDate(elements.end.value)) +
      escapeHtml(titleProject) + ' • Emitido em ' + escapeHtml(new Date().toLocaleString('pt-BR')) + '</p></header>';
    const metrics = data.metrics || {};
    html += '<div class="print-metrics"><span><strong>' + Number(metrics.faltas || 0) + '</strong> faltas</span><span><strong>' +
      Number(metrics.alunosComFalta || 0) + '</strong> alunos com falta</span><span><strong>' +
      Number(metrics.frequenciaPct || 0) + '%</strong> frequência geral</span></div>';

    html += '<section class="report-section"><h2>Prioridade de contato — ' + escapeHtml(elements.threshold.value) + '+ faltas</h2>';
    if (!ranking.length) {
      html += '<p>Nenhum aluno atingiu o limite selecionado.</p>';
    } else {
      html += '<table class="report-table"><thead><tr><th>#</th><th>Aluno</th><th>Setor</th><th>Faltas</th><th>Frequência</th><th>Última falta</th><th>Responsável</th></tr></thead><tbody>';
      ranking.forEach(function (row, index) {
        html += '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(row.student) + '</td><td>' + escapeHtml(row.group) +
          '</td><td>' + Number(row.faltas || 0) + '</td><td>' + Number(row.frequenciaPct || 0) + '%</td><td>' +
          escapeHtml(formatDate(row.ultimaFalta)) + '</td><td>' + escapeHtml(row.responsible || '—') + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</section>';

    html += '<section class="report-section"><h2>Resumo por setor</h2><table class="report-table"><thead><tr><th>Setor</th><th>Responsável</th><th>Faltas</th><th>Alunos com falta</th><th>Frequência</th></tr></thead><tbody>';
    summaries.forEach(function (row) {
      html += '<tr><td>' + escapeHtml(row.group) + '</td><td>' + escapeHtml(row.responsible || '—') + '</td><td>' +
        Number(row.faltas || 0) + '</td><td>' + Number(row.alunosComFalta || 0) + '</td><td>' +
        Number(row.frequenciaPct || 0) + '%</td></tr>';
    });
    html += '</tbody></table></section>';

    html += '<section class="report-section"><h2>Registros de falta</h2>';
    if (!rows.length) {
      html += '<p>Nenhuma falta registrada no período.</p>';
    } else {
      html += '<table class="report-table"><thead><tr><th>Data</th><th>Aluno</th><th>Setor</th><th>Responsável</th><th>Observação</th></tr></thead><tbody>';
      rows.forEach(function (row) {
        html += '<tr><td>' + escapeHtml(formatDate(row.date)) + '</td><td>' + escapeHtml(row.student) + '</td><td>' +
          escapeHtml(row.group) + '</td><td>' + escapeHtml(row.responsible || '—') + '</td><td>' +
          escapeHtml(row.observation || '—') + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    return html + '</section>';
  }

  async function printAbsences() {
    if (!validateDates()) return;
    try {
      const data = await Loading.run(function () {
        return AttendanceApi.getDashboard(filters({
          projeto: elements.project.value || '', faltas: '1', limit: '2000', rankingLimit: '300'
        }));
      }, { button: elements.print, buttonLabel: 'Preparando…', message: 'Preparando o relatório de faltas…' });
      elements.printArea.innerHTML = buildPrintReport(data);
      if (data.rowsMeta && data.rowsMeta.truncated) {
        showStatus('O período tem mais de 2.000 faltas. Reduza o período para imprimir todos os registros.', 'error');
        return;
      }
      setTimeout(function () { window.print(); }, 80);
    } catch (error) {
      showStatus(error.message || String(error), 'error');
    }
  }

  applyPeriodPreset('30');
  readInitialQuery();
  fillProjects(AttendanceApi.PROJECTS);
  elements.refresh.addEventListener('click', loadDashboard);
  elements.print.addEventListener('click', printAbsences);
  elements.preset.addEventListener('change', function () {
    applyPeriodPreset(elements.preset.value);
    loadDashboard();
  });
  elements.project.addEventListener('change', function () { selectProject(elements.project.value); });
  elements.threshold.addEventListener('change', loadDashboard);
  elements.start.addEventListener('change', function () {
    elements.preset.value = 'custom';
    state.allData = null;
    if (elements.end.value < elements.start.value) elements.end.value = elements.start.value;
  });
  elements.end.addEventListener('change', function () {
    elements.preset.value = 'custom';
    state.allData = null;
    if (elements.start.value > elements.end.value) elements.start.value = elements.end.value;
  });
  elements.riskSearch.addEventListener('input', function () {
    if (state.data) renderAttention(state.data);
  });
  elements.showAllSectors.addEventListener('click', function () { selectProject(''); });
  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-project].sector-card, .sector-filter-button[data-project]');
    if (button) selectProject(button.dataset.project || '');
  });
  loadDashboard();
})();
