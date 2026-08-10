(function () {
  const user = window.UI.requireAuth(['EDITOR']);
  if (!user) return;
  window.UI.mountNav('editor');

  const byId = function (id) { return document.getElementById(id); };
  const state = {
    students: [],
    sectors: [],
    types: [],
    competencies: [],
    selectedStudentId: '',
    requestedStudentId: window.UI.getParam('student_id') || ''
  };

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('pt-BR')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join('') || '+';
  }

  function todayIso() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function normalizeIsoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return br[3] + '-' + br[2] + '-' + br[1];
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function formatBirthDate(iso) {
    const parts = String(iso || '').split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : '';
  }

  function setBirthDateHelp(rawValue, normalizedValue) {
    const help = byId('st_birth_help');
    if (rawValue && normalizedValue) {
      help.textContent = 'Data cadastrada: ' + formatBirthDate(normalizedValue) + '. Só será alterada se você modificar este campo.';
      help.className = 'form-text birth-date-help';
    } else if (rawValue) {
      help.textContent = 'A data cadastrada não pôde ser exibida, mas será preservada ao salvar outros campos.';
      help.className = 'form-text birth-date-help is-warning';
    } else {
      help.textContent = 'Nenhuma data de nascimento está cadastrada para este aluno.';
      help.className = 'form-text birth-date-help';
    }
  }

  function findStudent(studentId) {
    return state.students.find(function (student) {
      return String(student.student_id || '') === String(studentId || '');
    }) || null;
  }

  function findName(items, idKey, nameKey, value) {
    const item = items.find(function (entry) {
      return String(entry[idKey] || '') === String(value || '');
    });
    return item ? String(item[nameKey] || '') : '';
  }

  function showPanel(name) {
    document.querySelectorAll('[data-editor-tab]').forEach(function (button) {
      const active = button.dataset.editorTab === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-editor-panel]').forEach(function (panel) {
      const active = panel.dataset.editorPanel === name;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
  }

  function fillSelect(select, items, valueKey, labelKey, emptyLabel, selectedValue) {
    const previous = selectedValue === undefined ? select.value : selectedValue;
    select.textContent = '';
    if (emptyLabel) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = emptyLabel;
      select.appendChild(empty);
    }
    items.forEach(function (item) {
      const option = document.createElement('option');
      option.value = String(item[valueKey] || '');
      option.textContent = String(item[labelKey] || '');
      select.appendChild(option);
    });
    if (previous && Array.from(select.options).some(function (option) { return option.value === previous; })) {
      select.value = previous;
    }
  }

  function fillStudentSelect(select, selectedValue, emptyLabel) {
    const previous = selectedValue === undefined ? select.value : selectedValue;
    select.textContent = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = emptyLabel || 'Selecione um aluno';
    select.appendChild(empty);
    state.students.forEach(function (student) {
      const option = document.createElement('option');
      option.value = String(student.student_id || '');
      option.textContent = String(student.name || 'Sem nome') +
        (String(student.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? ' — inativo' : '');
      select.appendChild(option);
    });
    if (previous && Array.from(select.options).some(function (option) { return option.value === previous; })) {
      select.value = previous;
    }
  }

  function renderStudentList() {
    const list = byId('studentEditorList');
    const query = normalize(byId('studentEditorSearch').value);
    const filtered = state.students.filter(function (student) {
      if (!query) return true;
      return [student.name, student.sector_current_name, student.scholarship_type_name]
        .some(function (value) { return normalize(value).includes(query); });
    });

    byId('studentListCount').textContent = filtered.length + ' de ' + state.students.length +
      (state.students.length === 1 ? ' aluno' : ' alunos');
    list.textContent = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'editor-list-empty';
      empty.textContent = 'Nenhum aluno encontrado com esta busca.';
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach(function (student) {
      const button = document.createElement('button');
      const inactive = String(student.status || 'ACTIVE').toUpperCase() === 'INACTIVE';
      button.type = 'button';
      button.className = 'student-editor-item' +
        (student.student_id === state.selectedStudentId ? ' is-selected' : '') +
        (inactive ? ' is-inactive' : '');
      button.dataset.studentId = student.student_id;

      const avatar = document.createElement('span');
      avatar.className = 'student-editor-avatar';
      avatar.textContent = initials(student.name);

      const copy = document.createElement('span');
      copy.className = 'student-editor-copy';
      const name = document.createElement('strong');
      name.textContent = student.name || 'Sem nome';
      const meta = document.createElement('small');
      meta.textContent = [
        student.sector_current_name || 'Sem setor',
        student.scholarship_type_name || 'Sem bolsa'
      ].join(' • ');
      copy.append(name, meta);

      const stateLabel = document.createElement('span');
      stateLabel.className = 'student-editor-state';
      stateLabel.textContent = inactive ? 'Inativo' : 'Editar';
      button.append(avatar, copy, stateLabel);
      button.addEventListener('click', function () { selectStudent(student.student_id, true); });
      fragment.appendChild(button);
    });
    list.appendChild(fragment);
  }

  function setStudentFormMode(student) {
    const badge = byId('studentModeBadge');
    const evaluateButton = byId('btnEvaluateStudent');
    if (!student) {
      byId('studentFormTitle').textContent = 'Novo aluno';
      byId('studentFormSubtitle').textContent = 'Preencha os dados para criar um cadastro.';
      byId('selectedStudentAvatar').textContent = '+';
      badge.textContent = 'Novo cadastro';
      badge.className = 'editor-mode-badge is-new';
      evaluateButton.hidden = true;
      byId('studentSaveHint').textContent = 'Um identificador será criado automaticamente ao salvar.';
      return;
    }

    byId('studentFormTitle').textContent = student.name || 'Aluno selecionado';
    byId('studentFormSubtitle').textContent = [
      student.sector_current_name || 'Sem setor',
      student.scholarship_type_name || 'Sem bolsa'
    ].join(' • ');
    byId('selectedStudentAvatar').textContent = initials(student.name);
    badge.textContent = 'Editando cadastro';
    badge.className = 'editor-mode-badge is-editing';
    evaluateButton.hidden = false;
    byId('studentSaveHint').textContent = 'As alterações serão aplicadas ao cadastro selecionado.';
  }

  function resetStudentForm(focusName) {
    state.selectedStudentId = '';
    byId('studentForm').reset();
    byId('st_id').value = '';
    byId('st_status').value = 'ACTIVE';
    byId('st_sector').value = '';
    byId('st_type').value = '';
    byId('st_birth_help').textContent = 'Informe a data de nascimento se ela estiver disponível.';
    byId('st_birth_help').className = 'form-text birth-date-help';
    setStudentFormMode(null);
    renderStudentList();
    if (focusName) byId('st_name').focus();
  }

  function selectStudent(studentId, scrollOnMobile) {
    const student = findStudent(studentId);
    if (!student) {
      window.UI.toast('Aluno não encontrado. Atualize os dados e tente novamente.', 'err');
      return;
    }

    state.selectedStudentId = student.student_id;
    byId('st_id').value = student.student_id || '';
    byId('st_name').value = student.name || '';
    byId('st_sex').value = student.sex || '';
    const birthDate = normalizeIsoDate(student.birth_date);
    byId('st_birth').value = birthDate;
    setBirthDateHelp(student.birth_date, birthDate);
    byId('st_phone').value = student.phone_display || student.phone_e164 || '';
    byId('st_sector').value = student.sector_current_id || '';
    byId('st_type').value = student.scholarship_type_id || '';
    byId('st_work').value = student.workload_minutes || '';
    byId('st_status').value = student.status || 'ACTIVE';
    byId('st_photo').value = student.photo_url || '';
    setStudentFormMode(student);
    renderStudentList();

    byId('ev_student').value = student.student_id;
    byId('qs_student').value = student.student_id;
    updateCurrentSector();
    renderScores();

    if (scrollOnMobile && window.matchMedia('(max-width: 900px)').matches) {
      document.querySelector('.student-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function updateCurrentSector() {
    const student = findStudent(byId('qs_student').value);
    byId('currentSectorText').textContent = student
      ? 'Setor atual: ' + (student.sector_current_name || 'não informado')
      : 'Selecione um aluno para consultar o setor atual.';
  }

  function renderScores() {
    const box = byId('scoresBox');
    box.textContent = '';
    if (!byId('ev_student').value) {
      const hint = document.createElement('div');
      hint.className = 'editor-list-empty';
      hint.textContent = 'Selecione um aluno para preencher as competências.';
      box.appendChild(hint);
      return;
    }
    if (!state.competencies.length) {
      const hint = document.createElement('div');
      hint.className = 'editor-list-empty';
      hint.textContent = 'Nenhuma competência ativa foi cadastrada.';
      box.appendChild(hint);
      return;
    }

    state.competencies.forEach(function (competency) {
      const row = document.createElement('div');
      row.className = 'score-row';
      const label = document.createElement('label');
      label.htmlFor = 'score_' + competency.comp_id;
      const name = document.createElement('strong');
      name.textContent = competency.name || 'Competência';
      const value = document.createElement('span');
      value.textContent = '0 / 10';
      label.append(name, value);
      const input = document.createElement('input');
      input.className = 'form-range';
      input.type = 'range';
      input.min = '0';
      input.max = '10';
      input.step = '1';
      input.value = '0';
      input.id = 'score_' + competency.comp_id;
      input.addEventListener('input', function () { value.textContent = input.value + ' / 10'; });
      row.append(label, input);
      box.appendChild(row);
    });
  }

  async function refreshData(force, preferredStudentId) {
    const evaluationStudent = byId('ev_student').value;
    const allocationStudent = byId('qs_student').value;
    const allocationSector = byId('qs_sector').value;
    const data = await window.Api.apiPost('getEditorBootstrap', {}, { noCache: !!force });

    state.students = (data.students || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
    state.sectors = (data.sectors || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
    state.types = (data.scholarship_types || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
    state.competencies = (data.competencies || []).filter(function (item) {
      return String(item.active || 'TRUE').toUpperCase() === 'TRUE';
    });

    fillSelect(byId('st_sector'), state.sectors, 'sector_id', 'name', 'Sem setor');
    fillSelect(byId('st_type'), state.types, 'type_id', 'name', 'Sem bolsa');
    fillSelect(byId('qs_sector'), state.sectors, 'sector_id', 'name', 'Selecione o novo setor', allocationSector);
    fillStudentSelect(byId('ev_student'), evaluationStudent);
    fillStudentSelect(byId('qs_student'), allocationStudent);
    renderStudentList();

    const targetId = preferredStudentId || state.selectedStudentId || state.requestedStudentId;
    if (targetId && findStudent(targetId)) {
      selectStudent(targetId, false);
      state.requestedStudentId = '';
    } else if (!state.selectedStudentId) {
      resetStudentForm(false);
    }
    updateCurrentSector();
    renderScores();
  }

  function runWithButton(button, buttonLabel, message, task) {
    return window.Loading.run(task, {
      button: button,
      buttonLabel: buttonLabel,
      message: message
    });
  }

  document.querySelectorAll('[data-editor-tab]').forEach(function (button) {
    button.addEventListener('click', function () { showPanel(button.dataset.editorTab); });
  });
  byId('studentEditorSearch').addEventListener('input', renderStudentList);
  byId('st_birth').addEventListener('change', function () {
    const student = findStudent(state.selectedStudentId);
    const original = normalizeIsoDate(student && student.birth_date);
    const current = byId('st_birth').value;
    if (original && !current) {
      byId('st_birth_help').textContent = 'Atenção: salvar assim removerá a data cadastrada. O sistema pedirá confirmação.';
      byId('st_birth_help').className = 'form-text birth-date-help is-warning';
    } else if (current && current !== original) {
      byId('st_birth_help').textContent = 'Nova data: ' + formatBirthDate(current) + '. A idade será recalculada ao salvar.';
      byId('st_birth_help').className = 'form-text birth-date-help is-warning';
    } else {
      setBirthDateHelp(student && student.birth_date, original);
    }
  });
  byId('btnNewStudent').addEventListener('click', function () { resetStudentForm(true); });
  byId('btnNewStudentTop').addEventListener('click', function () {
    showPanel('students');
    resetStudentForm(true);
  });
  byId('btnResetStudent').addEventListener('click', function () { resetStudentForm(true); });
  byId('btnEvaluateStudent').addEventListener('click', function () {
    if (!state.selectedStudentId) return;
    byId('ev_student').value = state.selectedStudentId;
    renderScores();
    showPanel('evaluations');
  });

  function studentFormValues() {
    const sectorId = byId('st_sector').value;
    const typeId = byId('st_type').value;
    return {
      name: byId('st_name').value.trim(),
      sex: byId('st_sex').value,
      birth_date: byId('st_birth').value,
      phone: byId('st_phone').value.trim(),
      photo_url: byId('st_photo').value.trim(),
      sector_current_id: sectorId,
      sector_current_name: findName(state.sectors, 'sector_id', 'name', sectorId),
      scholarship_type_id: typeId,
      scholarship_type_name: findName(state.types, 'type_id', 'name', typeId),
      workload_minutes: byId('st_work').value.trim(),
      status: byId('st_status').value
    };
  }

  function storedStudentValues(student) {
    return {
      name: String(student.name || '').trim(),
      sex: String(student.sex || ''),
      birth_date: normalizeIsoDate(student.birth_date),
      phone: String(student.phone_display || student.phone_e164 || '').trim(),
      photo_url: String(student.photo_url || '').trim(),
      sector_current_id: String(student.sector_current_id || ''),
      sector_current_name: String(student.sector_current_name || ''),
      scholarship_type_id: String(student.scholarship_type_id || ''),
      scholarship_type_name: String(student.scholarship_type_name || ''),
      workload_minutes: String(student.workload_minutes || '').trim(),
      status: String(student.status || 'ACTIVE')
    };
  }

  function buildStudentRequest() {
    const studentId = byId('st_id').value.trim();
    const current = studentFormValues();
    if (!studentId) return { student: Object.assign({ student_id: '' }, current), changed: true };

    const originalStudent = findStudent(studentId);
    if (!originalStudent) throw new Error('O cadastro original não está mais carregado. Atualize os dados e tente novamente.');
    const original = storedStudentValues(originalStudent);
    const patch = { student_id: studentId };
    const updateMask = [];

    ['name', 'sex', 'birth_date', 'phone', 'photo_url', 'workload_minutes', 'status'].forEach(function (field) {
      if (String(current[field] || '') === String(original[field] || '')) return;
      patch[field] = current[field];
      updateMask.push(field);
    });

    if (current.sector_current_id !== original.sector_current_id) {
      patch.sector_current_id = current.sector_current_id;
      patch.sector_current_name = current.sector_current_name;
      updateMask.push('sector_current_id', 'sector_current_name');
    }
    if (current.scholarship_type_id !== original.scholarship_type_id) {
      patch.scholarship_type_id = current.scholarship_type_id;
      patch.scholarship_type_name = current.scholarship_type_name;
      updateMask.push('scholarship_type_id', 'scholarship_type_name');
    }
    if (updateMask.indexOf('birth_date') !== -1 && !current.birth_date && original.birth_date) {
      patch.clear_birth_date = true;
    }

    patch.update_mask = updateMask;
    return { student: patch, changed: updateMask.length > 0 };
  }

  byId('studentForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    const name = byId('st_name').value.trim();
    if (!name) {
      window.UI.toast('Informe o nome do aluno.', 'err');
      byId('st_name').focus();
      return;
    }

    try {
      const prepared = buildStudentRequest();
      const payload = { student: prepared.student };
      if (!prepared.changed) {
        window.UI.toast('Nenhuma alteração foi feita neste cadastro.', 'ok');
        return;
      }
      if (payload.student.clear_birth_date && !window.confirm('Remover a data de nascimento deste aluno? A idade também será removida.')) {
        return;
      }
      let savedId = payload.student.student_id;
      await runWithButton(byId('btnSaveStudent'), 'Salvando…', 'Atualizando o cadastro do aluno…', async function () {
        const result = await window.Api.apiPost('upsertStudent', payload);
        savedId = savedId || result.student_id;
        await refreshData(true, savedId);
      });
      window.UI.toast('Cadastro salvo com sucesso.', 'ok');
    } catch (error) {
      window.UI.toast(error.message || String(error), 'err');
    }
  });

  byId('ev_student').addEventListener('change', function () {
    renderScores();
    byId('ev_preview').textContent = '—';
  });
  byId('btnSaveEval').addEventListener('click', async function () {
    const studentId = byId('ev_student').value;
    if (!studentId) return window.UI.toast('Selecione um aluno.', 'err');
    const scores = {};
    state.competencies.forEach(function (competency) {
      const input = byId('score_' + competency.comp_id);
      if (input) scores[competency.comp_id] = Number(input.value);
    });
    const evaluation = {
      student_id: studentId,
      date: byId('ev_date').value || todayIso(),
      period_tag: byId('ev_period').value.trim(),
      scores: scores,
      written_report: byId('ev_written').value.trim()
    };
    try {
      const result = await runWithButton(byId('btnSaveEval'), 'Salvando…', 'Registrando a avaliação…', function () {
        return window.Api.apiPost('createEvaluation', { evaluation: evaluation });
      });
      byId('ev_preview').textContent = result.auto_summary || 'Avaliação salva sem resumo automático.';
      window.UI.toast('Avaliação salva com sucesso.', 'ok');
    } catch (error) {
      window.UI.toast(error.message || String(error), 'err');
    }
  });

  byId('qs_student').addEventListener('change', updateCurrentSector);
  byId('btnQuickSector').addEventListener('click', async function () {
    const studentId = byId('qs_student').value;
    const sectorId = byId('qs_sector').value;
    if (!studentId || !sectorId) return window.UI.toast('Selecione o aluno e o novo setor.', 'err');
    try {
      await runWithButton(byId('btnQuickSector'), 'Atualizando…', 'Alterando o setor do aluno…', async function () {
        await window.Api.apiPost('setStudentSector', { student_id: studentId, sector_id: sectorId });
        await refreshData(true, state.selectedStudentId);
        byId('qs_student').value = studentId;
        byId('qs_sector').value = sectorId;
        updateCurrentSector();
      });
      window.UI.toast('Setor atualizado com sucesso.', 'ok');
    } catch (error) {
      window.UI.toast(error.message || String(error), 'err');
    }
  });

  function bindCatalogAction(buttonId, inputId, action, payloadFactory, successMessage) {
    const button = byId(buttonId);
    button.addEventListener('click', async function () {
      const input = byId(inputId);
      const name = input.value.trim();
      if (!name) {
        window.UI.toast('Informe um nome antes de adicionar.', 'err');
        input.focus();
        return;
      }
      try {
        await runWithButton(button, 'Adicionando…', successMessage, async function () {
          await window.Api.apiPost(action, payloadFactory(name));
          input.value = '';
          await refreshData(true, state.selectedStudentId);
        });
        window.UI.toast(successMessage, 'ok');
      } catch (error) {
        window.UI.toast(error.message || String(error), 'err');
      }
    });
  }

  bindCatalogAction('btnAddSector', 'new_sector_name', 'upsertSector',
    function (name) { return { sector: { name: name } }; }, 'Setor adicionado com sucesso.');
  bindCatalogAction('btnAddType', 'new_type_name', 'upsertScholarshipType',
    function (name) { return { scholarship_type: { name: name } }; }, 'Modalidade de bolsa adicionada.');
  bindCatalogAction('btnAddComp', 'new_comp_name', 'upsertCompetency',
    function (name) { return { competency: { name: name, weight: '1' } }; }, 'Competência adicionada.');

  byId('btnCreateViewer').addEventListener('click', async function () {
    const login = byId('vw_login').value.trim();
    const password = byId('vw_password').value;
    if (!login || password.length < 8) {
      window.UI.toast('Informe o usuário e uma senha com pelo menos 8 caracteres.', 'err');
      return;
    }
    try {
      await runWithButton(byId('btnCreateViewer'), 'Criando…', 'Criando o acesso de consulta…', function () {
        return window.Api.apiPost('createUser', { user: { login: login, password: password, role: 'VIEWER' } });
      });
      byId('vw_login').value = '';
      byId('vw_password').value = '';
      window.UI.toast('Usuário criado com sucesso.', 'ok');
    } catch (error) {
      window.UI.toast(error.message || String(error), 'err');
    }
  });

  byId('btnRefresh').addEventListener('click', async function () {
    try {
      await runWithButton(byId('btnRefresh'), 'Atualizando…', 'Atualizando alunos e cadastros…', function () {
        return refreshData(true, state.selectedStudentId);
      });
      window.UI.toast('Dados atualizados.', 'ok');
    } catch (error) {
      window.UI.toast(error.message || String(error), 'err');
    }
  });

  byId('ev_date').value = todayIso();
  renderScores();
  refreshData(false).catch(function (error) {
    byId('studentEditorList').innerHTML = '<div class="editor-list-empty">Não foi possível carregar os alunos.</div>';
    window.UI.toast(error.message || String(error), 'err');
  });
})();
