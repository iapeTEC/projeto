(function () {
  const ROLES = Object.freeze({
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    EDITOR: 'EDITOR',
    USER: 'USER'
  });
  const ROLE_LABELS = Object.freeze({
    OWNER: 'Proprietário / TI',
    ADMIN: 'Administrador',
    EDITOR: 'Editor',
    USER: 'Usuário'
  });
  const CAPABILITIES = Object.freeze({
    VIEW_ACADEMIC: 'academic:view',
    EDIT_ACADEMIC: 'academic:edit',
    MANAGE_ORGANIZATION: 'organization:manage',
    MANAGE_ACCESS: 'access:manage',
    VIEW_ATTENDANCE: 'attendance:view',
    RECORD_ATTENDANCE: 'attendance:record'
  });
  const ROLE_CAPABILITIES = Object.freeze({
    OWNER: Object.values(CAPABILITIES),
    ADMIN: [
      CAPABILITIES.VIEW_ACADEMIC, CAPABILITIES.EDIT_ACADEMIC,
      CAPABILITIES.MANAGE_ORGANIZATION, CAPABILITIES.VIEW_ATTENDANCE,
      CAPABILITIES.RECORD_ATTENDANCE
    ],
    EDITOR: [
      CAPABILITIES.VIEW_ACADEMIC, CAPABILITIES.EDIT_ACADEMIC,
      CAPABILITIES.VIEW_ATTENDANCE, CAPABILITIES.RECORD_ATTENDANCE
    ],
    USER: [CAPABILITIES.VIEW_ACADEMIC, CAPABILITIES.VIEW_ATTENDANCE]
  });

  function getUser() {
    return window.Api.getUser();
  }

  function roleLabel(role) {
    return ROLE_LABELS[String(role || '').toUpperCase()] || 'Acesso restrito';
  }

  function hasRole(roles, user) {
    const current = user || getUser();
    const allowed = Array.isArray(roles) ? roles : [roles];
    return !!current && allowed.map(function (role) { return String(role).toUpperCase(); })
      .indexOf(String(current.role || '').toUpperCase()) !== -1;
  }

  function can(capability, user) {
    const current = user || getUser();
    if (!current || !capability) return false;
    const capabilities = ROLE_CAPABILITIES[String(current.role || '').toUpperCase()] || [];
    return capabilities.indexOf(capability) !== -1;
  }

  function applyCapabilities(root, user) {
    const scope = root && root.querySelectorAll ? root : document;
    const current = user || getUser();
    scope.querySelectorAll('[data-required-capability]').forEach(function (element) {
      element.hidden = !can(element.dataset.requiredCapability, current);
    });
  }

  function setNotice(message) {
    try { sessionStorage.setItem('ui_notice', String(message || '')); } catch (error) {}
  }

  function consumeNotice() {
    try {
      const message = sessionStorage.getItem('ui_notice') || '';
      sessionStorage.removeItem('ui_notice');
      return message;
    } catch (error) {
      return '';
    }
  }

  function currentPage() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file + window.location.search + window.location.hash;
  }

  function redirectToLogin(reason) {
    const query = new URLSearchParams({ next: currentPage() });
    if (reason) query.set('reason', reason);
    window.location.replace('login.html?' + query.toString());
  }

  function denyAccess(user) {
    setNotice('Seu perfil (' + roleLabel(user && user.role) + ') não permite acessar essa área.');
    if (!/(?:^|\/)index\.html$/.test(window.location.pathname)) window.location.replace('index.html');
  }

  function requireAuth(requirement) {
    const token = window.Api.getToken();
    const user = getUser();
    if (!token || !user || !ROLE_CAPABILITIES[user.role]) {
      redirectToLogin('authentication-required');
      return null;
    }
    if (Array.isArray(requirement) && requirement.length && !hasRole(requirement, user)) {
      denyAccess(user);
      return null;
    }
    if (typeof requirement === 'string' && !can(requirement, user)) {
      denyAccess(user);
      return null;
    }
    return user;
  }

  function requireCapability(capability) {
    return requireAuth(capability);
  }

  function bindLogout(button) {
    if (!button) return;
    button.addEventListener('click', function () {
      const task = function () {
        return window.Api.apiPost('logout', {}).catch(function () {});
      };
      const runner = window.Loading
        ? window.Loading.run(task, { button: button, buttonLabel: 'Saindo…', message: 'Encerrando a sessão…' })
        : task();
      Promise.resolve(runner).finally(function () {
        window.Api.clearSession();
        // Marca a saída para a tela de acesso não reentrar sozinha com a mesma
        // conta Google — quem clica em "Sair" quer escolher a conta de novo.
        try { localStorage.setItem('iape_signed_out', '1'); } catch (storageError) {}
        window.location.replace('login.html');
      });
    });
  }

  function accountAvatar(user) {
    const photo = String(user && user.avatar_url || '').trim();
    if (/^https:\/\//.test(photo)) {
      // referrerpolicy: sem ele o googleusercontent devolve 403 para o GitHub Pages.
      return '<img class="nav-account-avatar nav-account-photo" src="' + window.Api.esc(photo) +
        '" alt="" width="32" height="32" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
    }
    const letter = String(user && (user.display_name || user.email) || 'U').charAt(0).toUpperCase();
    return '<span class="nav-account-avatar" aria-hidden="true">' + window.Api.esc(letter) + '</span>';
  }

  function mountNav(active) {
    const user = getUser();
    const nav = document.getElementById('appNav');
    if (!nav || !user) return;

    const academicManagement = can(CAPABILITIES.EDIT_ACADEMIC, user)
      ? '<li class="nav-item"><a class="nav-link ' + (active === 'editor' ? 'active' : '') + '" href="editor.html">Gestão</a></li>'
      : '';
    const accessManagement = can(CAPABILITIES.MANAGE_ACCESS, user)
      ? '<li class="nav-item"><a class="nav-link ' + (active === 'access' ? 'active' : '') + '" href="editor.html?tab=users">Acessos</a></li>'
      : '';
    const attendanceEntry = can(CAPABILITIES.RECORD_ATTENDANCE, user)
      ? '<li class="nav-item"><a class="nav-link" href="escolhersetores.html">Chamadas</a></li>'
      : '';
    const email = String(user.email || '');
    const avatar = accountAvatar(user);
    const displayName = String(user.display_name || '').trim() || email;
    const brandIcon = '<span class="app-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 10.5 16 5l11 5.5L16 16 5 10.5Z" fill="currentColor"/><path d="M9 14v7.2c4.3 3.4 9.7 3.4 14 0V14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M27 11v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>';

    nav.innerHTML = '<nav class="navbar navbar-expand-lg navbar-light no-print academic-navbar">' +
      '<div class="container-fluid app-nav-inner"><a class="navbar-brand academic-brand" href="index.html">' + brandIcon +
      '<span class="app-brand-copy"><strong>IAPE</strong><small>Gestão Estudantil</small></span></a>' +
      '<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMain" aria-label="Abrir menu"><span class="navbar-toggler-icon"></span></button>' +
      '<div class="collapse navbar-collapse" id="navMain"><ul class="navbar-nav me-auto mb-2 mb-lg-0">' +
      '<li class="nav-item"><a class="nav-link ' + (active === 'home' ? 'active' : '') + '" href="index.html">Visão geral</a></li>' +
      '<li class="nav-item"><a class="nav-link ' + (active === 'students' ? 'active' : '') + '" href="students.html">Alunos</a></li>' +
      '<li class="nav-item"><a class="nav-link" href="dashboard.html">Frequência</a></li>' +
      '<li class="nav-item"><a class="nav-link ' + (active === 'fichas' ? 'active' : '') + '" href="fichas.html">Fichas</a></li>' + attendanceEntry +
      academicManagement + accessManagement + '</ul><div class="nav-account">' + avatar +
      '<span class="nav-account-copy"><strong title="' + window.Api.esc(email) + '">' +
      window.Api.esc(displayName) + '</strong><small>' + window.Api.esc(roleLabel(user.role)) + '</small></span>' +
      '<button class="btn btn-outline-secondary btn-sm nav-logout" id="btnLogout" type="button">Sair</button></div></div></div></nav>';
    bindLogout(document.getElementById('btnLogout'));
  }

  function mountAttendanceAccount(target, suppliedUser) {
    const element = typeof target === 'string' ? document.getElementById(target) : target;
    const user = suppliedUser || getUser();
    if (!element || !user) return;
    element.className = 'attendance-account';
    element.innerHTML = '<span class="attendance-account-copy"><strong>' +
      window.Api.esc(String(user.display_name || '').trim() || user.email) +
      '</strong><small>' + window.Api.esc(roleLabel(user.role)) + '</small></span>' +
      '<button class="nav-logout-button" type="button">Sair</button>';
    bindLogout(element.querySelector('button'));
  }

  function getParam(name) {
    return new URL(window.location.href).searchParams.get(name);
  }

  function toast(message, type) {
    const element = document.getElementById('toastArea');
    if (!element) { setNotice(message); return; }
    const cssClass = type === 'err' ? 'alert-danger' : 'alert-success';
    element.innerHTML = '<div class="alert ' + cssClass + ' alert-dismissible fade show" role="alert">' +
      window.Api.esc(message) + '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fechar"></button></div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.UI = {
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    CAPABILITIES: CAPABILITIES,
    roleLabel: roleLabel,
    hasRole: hasRole,
    can: can,
    applyCapabilities: applyCapabilities,
    requireAuth: requireAuth,
    requireCapability: requireCapability,
    mountNav: mountNav,
    mountAttendanceAccount: mountAttendanceAccount,
    bindLogout: bindLogout,
    getParam: getParam,
    toast: toast,
    setNotice: setNotice,
    consumeNotice: consumeNotice,
    redirectToLogin: redirectToLogin
  };
})();
