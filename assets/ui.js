(function () {
  function getUser() {
    return window.Api.getUser();
  }

  function requireAuth(roles) {
    const token = window.Api.getToken();
    const user = getUser();
    if (!token || !user || !user.role) {
      window.location.replace('login.html');
      return null;
    }
    if (Array.isArray(roles) && roles.length && roles.indexOf(user.role) === -1) {
      alert('Acesso negado para o seu perfil (' + user.role + ').');
      window.location.replace('index.html');
      return null;
    }
    return user;
  }

  function mountNav(active) {
    const user = getUser();
    const role = user && user.role ? user.role : '';
    const appName = window.APP_CONFIG && window.APP_CONFIG.APP_NAME ? window.APP_CONFIG.APP_NAME : 'Sistema';
    const nav = document.getElementById('appNav');
    if (!nav) return;

    const editorLinks = role === 'EDITOR'
      ? '<li class="nav-item"><a class="nav-link ' + (active === 'editor' ? 'active' : '') + '" href="editor.html">Gestão</a></li>'
      : '';
    const roleLabel = role === 'EDITOR' ? 'Administrador' : 'Consulta';
    const brandIcon = '<span class="app-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 10.5 16 5l11 5.5L16 16 5 10.5Z" fill="currentColor"/><path d="M9 14v7.2c4.3 3.4 9.7 3.4 14 0V14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M27 11v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>';
    nav.innerHTML = '<nav class="navbar navbar-expand-lg navbar-light no-print academic-navbar">' +
      '<div class="container-fluid app-nav-inner"><a class="navbar-brand academic-brand" href="index.html">' + brandIcon +
      '<span class="app-brand-copy"><strong>IAPE</strong><small>Gestão Estudantil</small></span></a>' +
      '<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMain" aria-label="Abrir menu"><span class="navbar-toggler-icon"></span></button>' +
      '<div class="collapse navbar-collapse" id="navMain"><ul class="navbar-nav me-auto mb-2 mb-lg-0">' +
      '<li class="nav-item"><a class="nav-link ' + (active === 'home' ? 'active' : '') + '" href="index.html">Visão geral</a></li>' +
      '<li class="nav-item"><a class="nav-link ' + (active === 'students' ? 'active' : '') + '" href="students.html">Alunos</a></li>' +
      '<li class="nav-item"><a class="nav-link" href="escolhersetores.html">Frequência</a></li>' +
      editorLinks + '</ul><div class="nav-account"><span class="nav-account-avatar" aria-hidden="true">' +
      window.Api.esc(user && user.login ? user.login.charAt(0).toUpperCase() : 'U') + '</span><span class="nav-account-copy"><strong>' +
      window.Api.esc(user ? user.login : '') + '</strong><small>' + roleLabel + '</small></span>' +
      '<button class="btn btn-outline-secondary btn-sm nav-logout" id="btnLogout">Sair</button></div></div></div></nav>';

    const button = document.getElementById('btnLogout');
    if (button) {
      button.addEventListener('click', function () {
        Loading.run(function () { return window.Api.apiPost('logout', {}).catch(function () {}); }, {
          button: button, buttonLabel: 'Saindo…', message: 'Encerrando a sessão…'
        }).finally(function () {
          window.Api.clearSession();
          window.location.replace('login.html');
        });
      });
    }
  }

  function getParam(name) {
    return new URL(window.location.href).searchParams.get(name);
  }

  function toast(message, type) {
    const element = document.getElementById('toastArea');
    if (!element) { alert(message); return; }
    const cssClass = type === 'err' ? 'alert-danger' : 'alert-success';
    element.innerHTML = '<div class="alert ' + cssClass + ' alert-dismissible fade show" role="alert">' +
      window.Api.esc(message) + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.UI = { requireAuth, mountNav, getParam, toast };
})();
