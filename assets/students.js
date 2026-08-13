(function () {
  const user = window.UI.requireAuth();
  if (!user) return;
  window.UI.mountNav('students');

  const byId = function (id) { return document.getElementById(id); };
  const state = { students: [], sectors: [], types: [] };

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('pt-BR')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join('') || 'A';
  }

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

  function avatarHtml(student, className) {
    const fallback = window.Api.esc(initials(student.name));
    const urls = photoUrls(student.photo_url);
    const cssClass = className || 'student-list-avatar';
    if (!urls.primary) {
      return '<span class="' + cssClass + '">' + fallback + '</span>';
    }
    return '<span class="' + cssClass + '"><img src="' + window.Api.esc(urls.primary) +
      '" data-photo-fallback="' + window.Api.esc(urls.fallback || '') +
      '" data-photo-initials="' + fallback +
      '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>';
  }

  function whatsappButton(value) {
    const url = String(value || '').trim();
    if (!/^https:\/\/wa\.me\/\d+$/i.test(url)) return '<span class="text-muted small">—</span>';
    return '<a class="btn btn-sm btn-outline-success" target="_blank" rel="noopener" href="' +
      window.Api.esc(url) + '">WhatsApp</a>';
  }

  function profileHref(student) {
    return 'student.html?student_id=' + encodeURIComponent(student.student_id || '');
  }

  function rowHtml(student) {
    const phone = student.phone_display || student.phone_e164 || '';
    return '<tr><td><div class="d-flex align-items-center gap-2">' + avatarHtml(student) +
      '<div><div class="fw-semibold"><a href="' + profileHref(student) + '">' +
      window.Api.esc(student.name) + '</a></div><div class="small text-muted">Registro ' +
      window.Api.esc(student.student_id) + '</div></div></div></td><td>' +
      window.Api.esc(student.sector_current_name || '') + '</td><td>' +
      window.Api.esc(student.scholarship_type_name || '') + '</td><td>' +
      window.Api.esc(student.age || '') + '</td><td>' + window.Api.esc(phone) +
      '</td><td class="text-end">' + whatsappButton(student.whatsapp_link) + '</td></tr>';
  }

  function cardHtml(student) {
    const phone = student.phone_display || student.phone_e164 || '';
    return '<article class="card mb-2"><div class="card-body"><div class="d-flex justify-content-between gap-2">' +
      '<div class="d-flex gap-2">' + avatarHtml(student) + '<div><div class="fw-semibold"><a href="' +
      profileHref(student) + '">' + window.Api.esc(student.name) + '</a></div><div class="small text-muted">' +
      window.Api.esc(student.sector_current_name || 'Sem setor') + ' • ' +
      window.Api.esc(student.scholarship_type_name || 'Sem bolsa') + '</div><div class="small text-muted">Idade: ' +
      window.Api.esc(student.age || '—') + ' • Tel: ' + window.Api.esc(phone || '—') +
      '</div></div></div><div class="text-end">' + whatsappButton(student.whatsapp_link) +
      '</div></div></div></article>';
  }

  function currentFilters() {
    return {
      query: normalize(byId('f_q').value),
      phone: digits(byId('f_q').value),
      status: byId('f_status').value,
      sex: byId('f_sex').value,
      sectorId: byId('f_sector').value,
      typeId: byId('f_type').value,
      ageMin: byId('f_age_min').value === '' ? null : Number(byId('f_age_min').value),
      ageMax: byId('f_age_max').value === '' ? null : Number(byId('f_age_max').value)
    };
  }

  function filterStudents() {
    const filters = currentFilters();
    return state.students.filter(function (student) {
      if (filters.status && String(student.status || 'ACTIVE').toUpperCase() !== filters.status) return false;
      if (filters.sex && String(student.sex || '').toUpperCase() !== filters.sex) return false;
      if (filters.sectorId && String(student.sector_current_id || '') !== filters.sectorId) return false;
      if (filters.typeId && String(student.scholarship_type_id || '') !== filters.typeId) return false;
      const age = Number(student.age);
      if (filters.ageMin !== null && (!Number.isFinite(age) || age < filters.ageMin)) return false;
      if (filters.ageMax !== null && (!Number.isFinite(age) || age > filters.ageMax)) return false;
      if (!filters.query) return true;
      const nameMatches = normalize(student.name).includes(filters.query);
      const phoneMatches = filters.phone.length >= 2 && digits(student.phone_display || student.phone_e164).includes(filters.phone);
      return nameMatches || phoneMatches;
    });
  }

  function closeSuggestions() {
    byId('studentSuggestions').hidden = true;
    byId('f_q').setAttribute('aria-expanded', 'false');
  }

  function renderSuggestions(rows) {
    const box = byId('studentSuggestions');
    const query = normalize(byId('f_q').value);
    box.textContent = '';
    if (!query || document.activeElement !== byId('f_q')) {
      closeSuggestions();
      return;
    }

    const matches = rows.slice(0, 8);
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'student-suggestion-empty';
      empty.textContent = 'Nenhum aluno encontrado com esse nome.';
      box.appendChild(empty);
    } else {
      matches.forEach(function (student) {
        const link = document.createElement('a');
        link.className = 'student-suggestion-link';
        link.href = profileHref(student);
        link.setAttribute('role', 'option');
        link.innerHTML = avatarHtml(student, 'student-suggestion-avatar') +
          '<span><strong>' + window.Api.esc(student.name) + '</strong><small>' +
          window.Api.esc(student.sector_current_name || 'Sem setor') + ' • ' +
          window.Api.esc(student.scholarship_type_name || 'Sem bolsa') + '</small></span><b>Abrir perfil</b>';
        box.appendChild(link);
      });
    }
    box.hidden = false;
    byId('f_q').setAttribute('aria-expanded', 'true');
  }

  function renderDirectory() {
    const rows = filterStudents();
    byId('countBadge').textContent = String(rows.length);
    byId('directorySummary').textContent = rows.length === 1
      ? '1 aluno corresponde à busca.'
      : rows.length + ' alunos correspondem à busca.';
    byId('tblBody').innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : '<tr><td colspan="6" class="empty-table">Nenhum aluno encontrado. Revise o nome ou os filtros.</td></tr>';
    byId('cardsList').innerHTML = rows.length
      ? rows.map(cardHtml).join('')
      : '<div class="empty-table">Nenhum aluno encontrado. Revise o nome ou os filtros.</div>';
    renderSuggestions(rows);
  }

  function fillSelect(select, items, idKey) {
    const selected = select.value;
    select.length = 1;
    items.forEach(function (item) {
      const option = document.createElement('option');
      option.value = String(item[idKey] || '');
      option.textContent = String(item.name || '');
      select.appendChild(option);
    });
    if (selected && Array.from(select.options).some(function (option) { return option.value === selected; })) {
      select.value = selected;
    }
  }

  async function loadStudents(noCache) {
    byId('countBadge').textContent = '…';
    byId('directorySummary').textContent = 'Atualizando os cadastros…';
    const data = await window.Api.apiPost('getStudentDirectory', {
      filters: {}, include_meta: 'TRUE'
    }, { noCache: !!noCache });
    state.students = (data.students || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
    state.sectors = (data.sectors || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
    state.types = (data.scholarship_types || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
    fillSelect(byId('f_sector'), state.sectors, 'sector_id');
    fillSelect(byId('f_type'), state.types, 'type_id');
    renderDirectory();
  }

  function resetFilters() {
    byId('f_q').value = '';
    byId('f_status').value = 'ACTIVE';
    byId('f_sex').value = '';
    byId('f_sector').value = '';
    byId('f_type').value = '';
    byId('f_age_min').value = '';
    byId('f_age_max').value = '';
    closeSuggestions();
    renderDirectory();
    byId('f_q').focus();
  }

  byId('f_q').addEventListener('input', renderDirectory);
  document.addEventListener('error', function (event) {
    const image = event.target;
    if (!image || image.tagName !== 'IMG' || !image.hasAttribute('data-photo-initials')) return;
    const fallbackUrl = image.getAttribute('data-photo-fallback');
    if (fallbackUrl) {
      image.removeAttribute('data-photo-fallback');
      image.src = fallbackUrl;
      return;
    }
    if (image.parentElement) image.parentElement.textContent = image.getAttribute('data-photo-initials') || 'A';
  }, true);
  byId('f_q').addEventListener('focus', function () { renderSuggestions(filterStudents()); });
  byId('f_q').addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeSuggestions();
    if (event.key === 'ArrowDown') {
      const first = byId('studentSuggestions').querySelector('.student-suggestion-link');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  ['f_status', 'f_sex', 'f_sector', 'f_type'].forEach(function (id) {
    byId(id).addEventListener('change', renderDirectory);
  });
  ['f_age_min', 'f_age_max'].forEach(function (id) {
    byId(id).addEventListener('input', renderDirectory);
  });
  byId('btnReset').addEventListener('click', resetFilters);
  byId('btnReload').addEventListener('click', async function () {
    try {
      await window.Loading.run(function () { return loadStudents(true); }, {
        button: byId('btnReload'), buttonLabel: 'Atualizando…', message: 'Atualizando os cadastros de alunos…'
      });
      window.UI.toast('Dados atualizados.', 'ok');
    } catch (error) {
      window.UI.toast(error.message || String(error), 'err');
    }
  });
  document.addEventListener('click', function (event) {
    if (!byId('studentSearchPanel').contains(event.target)) closeSuggestions();
  });

  loadStudents(false).catch(function (error) {
    byId('countBadge').textContent = '—';
    byId('directorySummary').textContent = 'Não foi possível carregar os cadastros.';
    window.UI.toast(error.message || String(error), 'err');
  });
})();
