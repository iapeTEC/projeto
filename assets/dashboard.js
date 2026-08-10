(function () {
  const elements = {
    start: document.getElementById('start-date'),
    end: document.getElementById('end-date'),
    project: document.getElementById('project-filter'),
    refresh: document.getElementById('refresh-dashboard'),
    print: document.getElementById('print-absences'),
    status: document.getElementById('dashboard-status'),
    summary: document.querySelector('#summary-table tbody'),
    observations: document.querySelector('#observations-table tbody'),
    rows: document.querySelector('#rows-table tbody'),
    updated: document.getElementById('last-updated'),
    printArea: document.getElementById('print-area')
  };
  let requestNumber = 0;

  function todayIso() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    const parts = String(value || '').slice(0, 10).split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value;
  }

  function setMetric(id, value, suffix) {
    document.getElementById(id).textContent = String(value == null ? 0 : value) + (suffix || '');
  }

  function fillTable(target, rows, columns) {
    target.innerHTML = rows.length ? rows.join('') :
      '<tr><td colspan="' + columns + '"><div class="empty">Sem dados no período selecionado.</div></td></tr>';
  }

  function fillProjects(projects) {
    const current = elements.project.value;
    elements.project.innerHTML = '<option value="">Todos os projetos</option>';
    (projects || []).forEach(function (item) {
      const name = String(item.projeto || item.project || item.group || item || '').trim();
      if (!name) return;
      const responsible = String(item.responsavel || item.responsible || '').trim();
      const option = document.createElement('option');
      option.value = name;
      option.textContent = responsible ? name + ' — ' + responsible : name;
      elements.project.appendChild(option);
    });
    if (current) elements.project.value = current;
  }

  function render(data) {
    const metrics = data.metrics || {};
    setMetric('metric-total', Number(metrics.totalLancamentos || 0));
    setMetric('metric-present', Number(metrics.presentes || 0));
    setMetric('metric-absent', Number(metrics.faltas || 0));
    setMetric('metric-percent', Number(metrics.frequenciaPct || 0), '%');
    setMetric('metric-observations', Number(metrics.observacoes || 0));

    const summaryRows = (data.resumoPorGrupo || []).map(function (row) {
      return '<tr><td><strong>' + escapeHtml(row.group || row.projeto) + '</strong></td>' +
        '<td>' + Number(row.total || 0) + '</td><td>' + Number(row.presentes || 0) + '</td>' +
        '<td>' + Number(row.faltas || 0) + '</td><td>' + Number(row.observacoes || 0) + '</td>' +
        '<td><strong>' + Number(row.frequenciaPct || 0) + '%</strong></td></tr>';
    });
    fillTable(elements.summary, summaryRows, 6);

    const observationRows = (data.observacoes || []).slice(0, 8).map(function (row) {
      return '<tr><td>' + escapeHtml(formatDate(row.date)) + '</td><td>' + escapeHtml(row.group) +
        '</td><td>' + escapeHtml(row.student) + '</td><td>' + escapeHtml(row.observation) + '</td></tr>';
    });
    fillTable(elements.observations, observationRows, 4);

    const recentRows = (data.rows || []).slice(0, 20).map(function (row) {
      const present = Number(row.present) === 1;
      return '<tr><td>' + escapeHtml(formatDate(row.date)) + '</td><td>' + escapeHtml(row.group) +
        '</td><td>' + escapeHtml(row.responsible) + '</td><td>' + escapeHtml(row.student) + '</td><td>' +
        (present ? '<span class="badge ok">Presente</span>' : '<span class="badge no">Falta</span>') +
        '</td><td>' + escapeHtml(row.source) + '</td></tr>';
    });
    fillTable(elements.rows, recentRows, 6);
    if (data.projects && data.projects.length) fillProjects(data.projects);
    elements.updated.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function showStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = 'status is-visible ' + (type || 'success');
  }

  function filters(extra) {
    return Object.assign({
      start: elements.start.value || todayIso(),
      end: elements.end.value || todayIso(),
      projeto: elements.project.value || '',
      rows: '1',
      limit: '50'
    }, extra || {});
  }

  async function loadDashboard() {
    const currentRequest = ++requestNumber;
    elements.status.className = 'status';
    try {
      const data = await Loading.run(function () {
        return AttendanceApi.getDashboard(filters());
      }, { button: elements.refresh, buttonLabel: 'Atualizando…', message: 'Carregando indicadores e lançamentos…' });
      if (currentRequest === requestNumber) render(data);
    } catch (error) {
      if (currentRequest === requestNumber) showStatus(error.message || String(error), 'error');
    }
  }

  function groupAbsences(rows) {
    return (rows || []).filter(function (row) { return Number(row.present) !== 1; })
      .reduce(function (map, row) {
        const key = String(row.group || 'Sem projeto');
        if (!map[key]) map[key] = [];
        map[key].push(row);
        return map;
      }, {});
  }

  function buildPrintReport(data) {
    const groups = groupAbsences(data.rows || []);
    const names = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    const total = names.reduce(function (sum, name) { return sum + groups[name].length; }, 0);
    let html = '<h1 style="font:700 22px Arial;margin:0 0 5px">Relatório de faltas</h1>' +
      '<p style="font:13px Arial;color:#555;margin:0 0 18px">Período: ' + escapeHtml(formatDate(elements.start.value)) +
      ' a ' + escapeHtml(formatDate(elements.end.value)) + ' • Total: ' + total + '</p>';
    if (!names.length) return html + '<p>Nenhuma falta registrada no período.</p>';

    names.forEach(function (name) {
      html += '<section class="report-section"><h2 style="font:700 16px Arial">' + escapeHtml(name) +
        ' (' + groups[name].length + ')</h2><table class="report-table"><thead><tr>' +
        '<th>Data</th><th>Aluno</th><th>Responsável</th><th>Origem</th><th>Observação</th>' +
        '</tr></thead><tbody>';
      groups[name].forEach(function (row) {
        html += '<tr><td>' + escapeHtml(formatDate(row.date)) + '</td><td>' + escapeHtml(row.student) +
          '</td><td>' + escapeHtml(row.responsible) + '</td><td>' + escapeHtml(row.source) +
          '</td><td>' + escapeHtml(row.observation) + '</td></tr>';
      });
      html += '</tbody></table></section>';
    });
    return html;
  }

  async function printAbsences() {
    try {
      const data = await Loading.run(function () {
        return AttendanceApi.getDashboard(filters({ faltas: '1', limit: '2000' }));
      }, { button: elements.print, buttonLabel: 'Preparando…', message: 'Preparando o relatório de faltas…' });
      elements.printArea.innerHTML = buildPrintReport(data);
      setTimeout(function () { window.print(); }, 80);
    } catch (error) {
      showStatus(error.message || String(error), 'error');
    }
  }

  const today = todayIso();
  elements.start.value = today;
  elements.end.value = today;
  fillProjects(AttendanceApi.PROJECTS);
  elements.refresh.addEventListener('click', loadDashboard);
  elements.print.addEventListener('click', printAbsences);
  elements.project.addEventListener('change', loadDashboard);
  elements.start.addEventListener('change', function () {
    if (elements.end.value < elements.start.value) elements.end.value = elements.start.value;
  });
  elements.end.addEventListener('change', function () {
    if (elements.start.value > elements.end.value) elements.start.value = elements.end.value;
  });
  loadDashboard();
})();
