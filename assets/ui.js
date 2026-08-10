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
      ? '<li class="nav-item"><a class="nav-link ' + (active === 'editor' ? 'active' : '') + '" href="editor.html">Editor</a></li>'
      : '';
    nav.innerHTML = '<nav class="navbar navbar-expand-lg navbar-light bg-white border-bottom no-print">' +
      '<div class="container-fluid"><a class="navbar-brand" href="index.html">' + window.Api.esc(appName) + '</a>' +
      '<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMain" aria-label="Abrir menu"><span class="navbar-toggler-icon"></span></button>' +
      '<div class="collapse navbar-collapse" id="navMain"><ul class="navbar-nav me-auto mb-2 mb-lg-0">' +
      '<li class="nav-item"><a class="nav-link ' + (active === 'home' ? 'active' : '') + '" href="index.html">Início</a></li>' +
      '<li class="nav-item"><a class="nav-link ' + (active === 'students' ? 'active' : '') + '" href="students.html">Alunos</a></li>' +
      '<li class="nav-item"><a class="nav-link" href="escolhersetores.html">Frequência</a></li>' +
      editorLinks + '</ul><div class="d-flex align-items-center gap-2"><span class="small text-muted">' +
      window.Api.esc(user ? user.login + ' • ' + user.role : '') + '</span>' +
      '<button class="btn btn-outline-secondary btn-sm" id="btnLogout">Sair</button></div></div></div></nav>';

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
