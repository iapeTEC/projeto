(function () {
  const user = window.UI.requireCapability(window.UI.CAPABILITIES.VIEW_ACADEMIC);
  if (!user) return;
  window.UI.mountAttendanceAccount('fichasAccount', user);

  const FICHAS_PER_PAGE = 6;
  const STORE_KEY = 'fichas:selection:v1';

  const byId = function (id) { return document.getElementById(id); };
  const elements = {
    status: byId('fichas-status'),
    search: byId('ficha-search'),
    sector: byId('ficha-sector'),
    type: byId('ficha-type'),
    situation: byId('ficha-status'),
    list: byId('fichas-list'),
    count: byId('fichas-count'),
    selected: byId('fichas-selected'),
    selectFiltered: byId('select-filtered'),
    clearSelection: byId('clear-selection'),
    print: byId('print-fichas'),
    absencePeriod: byId('absence-period'),
    absenceStart: byId('absence-start'),
    absenceEnd: byId('absence-end'),
    printArea: byId('print-area')
  };

  const state = {
    students: [],
    sectors: [],
    types: [],
    filtered: [],
    selected: new Set(),
    absencesByName: null
  };

  /* ---------- utilidades ---------- */

  function esc(value) { return window.Api.esc(value); }

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('pt-BR')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join('') || 'A';
  }

  // Mesma resolução de foto do diretório: WebP de 128 px primeiro, original como reserva.
  function photoUrls(photo) {
    const raw = String(photo || '').trim().replace(/^\.\//, '');
    if (!raw) return {};
    if (/^https?:\/\//i.test(raw)) return { primary: raw };
    const clean = raw.replace(/^\.\.\//, '').replace(/^\//, '');
    if (!/^img\/[\w\-. À-ɏ]+$/i.test(clean)) return {};
    const file = clean.split('/').pop();
    return {
      primary: 'img/optimized/' + encodeURIComponent(file.replace(/\.[^.]+$/, '')) + '.webp',
      fallback: clean.split('/').map(encodeURIComponent).join('/')
    };
  }

  // eager: a área de impressão fica display:none, e uma imagem lazy dentro dela
  // nunca entra na viewport — logo, nunca carrega e a ficha sairia sem foto.
  function photoHtml(student, cssClass, eager) {
    const urls = photoUrls(student.photo_url);
    const fallbackText = esc(initials(student.name));
    if (!urls.primary) return '<span class="' + cssClass + '">' + fallbackText + '</span>';
    return '<span class="' + cssClass + '"><img src="' + esc(urls.primary) +
      '" data-photo-fallback="' + esc(urls.fallback || '') + '" data-photo-initials="' + fallbackText +
      '" alt="" loading="' + (eager ? 'eager' : 'lazy') + '" decoding="async" referrerpolicy="no-referrer"></span>';
  }

  // Nunca deixa a impressão pendurada por uma foto que não responde.
  function whenSettled(image, timeoutMs) {
    if (image.complete) return null;
    return new Promise(function (resolve) {
      const done = function () { clearTimeout(timer); resolve(); };
      const timer = setTimeout(resolve, timeoutMs);
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
    });
  }

  function formatDate(value) {
    const parts = String(value || '').slice(0, 10).split('-');
    return parts.length === 3 && parts[0].length === 4 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(value || '');
  }

  function localIso(date) {
    const value = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return value.toISOString().slice(0, 10);
  }

  function setStatus(message, kind) {
    elements.status.textContent = message || '';
    elements.status.className = 'status' + (message ? ' is-' + (kind || 'info') : '');
  }

  function selectedFields() {
    const fields = {};
    document.querySelectorAll('[data-field]').forEach(function (input) {
      fields[input.dataset.field] = input.checked;
    });
    return fields;
  }

  /* ---------- seleção persistida ---------- */

  function restoreSelection() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) JSON.parse(raw).forEach(function (id) { state.selected.add(String(id)); });
    } catch (error) {}
  }

  function storeSelection() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(Array.from(state.selected)));
    } catch (error) {}
  }

  /* ---------- filtros e lista ---------- */

  function applyFilters() {
    const term = normalize(elements.search.value);
    const sector = elements.sector.value;
    const type = elements.type.value;
    const situation = elements.situation.value;

    state.filtered = state.students.filter(function (student) {
      if (situation && String(student.status || 'ACTIVE').toUpperCase() !== situation) return false;
      if (sector && String(student.sector_current_id || '') !== sector) return false;
      if (type && String(student.scholarship_type_id || '') !== type) return false;
      if (!term) return true;
      return normalize(student.name).indexOf(term) !== -1 ||
        String(student.phone_display || '').indexOf(term) !== -1;
    });
    renderList();
  }

  function renderList() {
    elements.count.textContent = state.filtered.length === 1
      ? '1 aluno no filtro' : state.filtered.length + ' alunos no filtro';

    if (!state.filtered.length) {
      elements.list.innerHTML = '<div class="empty">Nenhum aluno corresponde aos filtros.</div>';
      renderSelectedCount();
      return;
    }

    elements.list.innerHTML = state.filtered.map(function (student) {
      const id = String(student.student_id);
      const checked = state.selected.has(id);
      return '<label class="fichas-row' + (checked ? ' is-selected' : '') + '" data-student="' + esc(id) + '">' +
        '<input type="checkbox"' + (checked ? ' checked' : '') + '>' +
        photoHtml(student, 'fichas-avatar') +
        '<span class="fichas-row-copy"><strong>' + esc(student.name) + '</strong><small>' +
        esc(student.sector_current_name || 'Sem setor') + ' • ' +
        esc(student.scholarship_type_name || 'Sem bolsa') + '</small></span></label>';
    }).join('');
    renderSelectedCount();
  }

  function renderSelectedCount() {
    const total = state.selected.size;
    elements.selected.textContent = total === 1 ? '1 aluno selecionado' : total + ' alunos selecionados';
    elements.print.disabled = total === 0;
  }

  /* ---------- faltas do período (opcional) ---------- */

  async function loadAbsences() {
    const start = elements.absenceStart.value;
    const end = elements.absenceEnd.value;
    if (!start || !end || start > end) throw new Error('Informe um período válido para as faltas.');

    const data = await window.AttendanceApi.getDashboard({
      start: start, end: end, rows: '0', faltas: '1', minFaltas: 1, rankingLimit: 300
    });
    const map = new Map();
    (data.rankingAlunos || []).forEach(function (row) {
      map.set(normalize(row.student), Number(row.faltas || 0));
    });
    state.absencesByName = map;
    return map;
  }

  /* ---------- ficha impressa ---------- */

  function fichaHtml(student, fields, absences) {
    const rows = [];
    const add = function (label, value) {
      if (value === undefined || value === null || value === '') return;
      rows.push('<dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd>');
    };

    if (fields.birth) add('Nascimento', formatDate(student.birth_date));
    if (fields.age && student.age !== '') add('Idade', student.age + ' anos');
    if (fields.sex) add('Sexo', student.sex === 'F' ? 'Feminino' : (student.sex === 'M' ? 'Masculino' : student.sex));
    if (fields.phone) add('Telefone', student.phone_display || student.phone_e164);
    if (fields.workload && student.workload_minutes !== '') add('Carga horária', student.workload_minutes + ' min');
    if (fields.situation) add('Situação', String(student.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'Ativo' : 'Inativo');
    if (fields.registry) add('Registro', student.student_id);
    if (fields.notes && student.notes) add('Observações', String(student.notes).slice(0, 180));

    let absenceFlag = '';
    if (fields.absences && absences) {
      const total = absences.get(normalize(student.name)) || 0;
      absenceFlag = '<span class="ficha-flag">' +
        (total === 1 ? '1 falta no período' : total + ' faltas no período') + '</span>';
    }

    const subtitleParts = [];
    if (fields.sector) subtitleParts.push(student.sector_current_name || 'Sem setor');
    if (fields.scholarship) subtitleParts.push(student.scholarship_type_name || 'Sem bolsa');

    return '<article class="ficha">' + photoHtml(student, 'ficha-photo', true) +
      '<div class="ficha-body"><h3 class="ficha-name">' + esc(student.name) + '</h3>' +
      (subtitleParts.length ? '<p class="ficha-sub">' + esc(subtitleParts.join(' • ')) + '</p>' : '') +
      (rows.length ? '<dl class="ficha-fields">' + rows.join('') + '</dl>' : '') +
      absenceFlag + '</div></article>';
  }

  function buildReport(students, fields, absences) {
    const filterLabel = [
      elements.sector.options[elements.sector.selectedIndex].text,
      elements.type.options[elements.type.selectedIndex].text
    ].filter(function (part) { return part && part.indexOf('Todos') !== 0 && part.indexOf('Todas') !== 0; });

    let html = '<header class="print-report-header"><p>IAPE • Gestão Estudantil</p>' +
      '<h1>Fichas de alunos</h1><p>' + students.length + ' ' + (students.length === 1 ? 'aluno' : 'alunos') +
      (filterLabel.length ? ' • ' + esc(filterLabel.join(' • ')) : '') +
      (fields.absences ? ' • Faltas de ' + esc(formatDate(elements.absenceStart.value)) +
        ' a ' + esc(formatDate(elements.absenceEnd.value)) : '') +
      ' • Emitido em ' + esc(new Date().toLocaleString('pt-BR')) + '</p></header>';

    for (let index = 0; index < students.length; index += FICHAS_PER_PAGE) {
      html += '<section class="ficha-page">' + students.slice(index, index + FICHAS_PER_PAGE)
        .map(function (student) { return fichaHtml(student, fields, absences); }).join('') + '</section>';
    }
    return html;
  }

  async function printFichas() {
    const fields = selectedFields();
    const students = state.students
      .filter(function (student) { return state.selected.has(String(student.student_id)); })
      .sort(function (a, b) { return normalize(a.name).localeCompare(normalize(b.name), 'pt-BR'); });

    if (!students.length) {
      setStatus('Selecione ao menos um aluno para emitir o relatório.', 'error');
      return;
    }

    try {
      const absences = fields.absences ? await loadAbsences() : null;
      elements.printArea.innerHTML = buildReport(students, fields, absences);
      // Espera as fotos carregarem: imprimir antes disso gera fichas sem foto.
      await Promise.all(Array.from(elements.printArea.querySelectorAll('img'))
        .map(function (image) { return whenSettled(image, 6000); }));
      setStatus(students.length + ' fichas prontas para impressão.', 'ok');
      setTimeout(function () { window.print(); }, 80);
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  }

  /* ---------- eventos ---------- */

  elements.list.addEventListener('change', function (event) {
    const row = event.target.closest('.fichas-row');
    if (!row) return;
    const id = row.dataset.student;
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    row.classList.toggle('is-selected', event.target.checked);
    storeSelection();
    renderSelectedCount();
  });

  elements.selectFiltered.addEventListener('click', function () {
    state.filtered.forEach(function (student) { state.selected.add(String(student.student_id)); });
    storeSelection();
    renderList();
  });

  elements.clearSelection.addEventListener('click', function () {
    state.selected.clear();
    storeSelection();
    renderList();
  });

  let searchTimer = null;
  elements.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 120);
  });
  [elements.sector, elements.type, elements.situation].forEach(function (control) {
    control.addEventListener('change', applyFilters);
  });

  byId('field-absences').addEventListener('change', function (event) {
    elements.absencePeriod.hidden = !event.target.checked;
  });

  elements.print.addEventListener('click', printFichas);

  // Foto otimizada ausente: cai para o arquivo original e, se faltar, para as iniciais.
  document.addEventListener('error', function (event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.photoInitials) return;
    const fallback = image.dataset.photoFallback;
    if (fallback) {
      image.dataset.photoFallback = '';
      image.src = fallback;
      return;
    }
    const holder = image.parentElement;
    if (holder) holder.textContent = image.dataset.photoInitials;
  }, true);

  /* ---------- carga inicial ---------- */

  function fillSelect(select, items, valueKey, labelKey, placeholder) {
    select.innerHTML = '<option value="">' + placeholder + '</option>' + items
      .filter(function (item) { return String(item.active || 'TRUE').toUpperCase() !== 'FALSE'; })
      .sort(function (a, b) { return String(a[labelKey] || '').localeCompare(String(b[labelKey] || ''), 'pt-BR'); })
      .map(function (item) {
        return '<option value="' + esc(item[valueKey]) + '">' + esc(item[labelKey]) + '</option>';
      }).join('');
  }

  (async function boot() {
    const today = new Date();
    elements.absenceEnd.value = localIso(today);
    elements.absenceStart.value = localIso(new Date(today.getTime() - 29 * 86400000));

    try {
      setStatus('Carregando o diretório de alunos…', 'info');
      // Mesmo payload de students.js de propósito: a chave do cache é o par
      // ação+payload, então as duas telas dividem uma única ida ao Apps Script.
      const data = await window.Api.apiPost('getStudentDirectory', {
        filters: {}, include_meta: 'TRUE'
      });
      state.students = data.students || [];
      state.sectors = data.sectors || [];
      state.types = data.scholarship_types || [];

      fillSelect(elements.sector, state.sectors, 'sector_id', 'name', 'Todos os setores');
      fillSelect(elements.type, state.types, 'type_id', 'name', 'Todas as bolsas');

      restoreSelection();
      // Descarta seleções de alunos que saíram da base entre uma sessão e outra.
      const known = new Set(state.students.map(function (student) { return String(student.student_id); }));
      Array.from(state.selected).forEach(function (id) { if (!known.has(id)) state.selected.delete(id); });

      applyFilters();
      setStatus('', 'info');
    } catch (error) {
      setStatus(error.message || String(error), 'error');
      elements.list.innerHTML = '<div class="empty">Não foi possível carregar os alunos.</div>';
    }
  })();
})();
