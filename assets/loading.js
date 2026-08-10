(function () {
  const active = new Map();
  let sequence = 0;

  function mount() {
    let root = document.getElementById('app-loading');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'app-loading';
    root.className = 'app-loading';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = [
      '<div class="app-loading-bar" aria-hidden="true"><span></span></div>',
      '<div class="app-loading-pill">',
      '  <span class="app-loading-spinner" aria-hidden="true"></span>',
      '  <span class="app-loading-message">Carregando…</span>',
      '</div>'
    ].join('');
    document.body.appendChild(root);
    return root;
  }

  function render() {
    const root = mount();
    const entries = Array.from(active.values());
    const visible = entries.length > 0;
    root.classList.toggle('is-visible', visible);
    root.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (visible) {
      root.querySelector('.app-loading-message').textContent = entries[entries.length - 1];
    }
  }

  function start(message) {
    const token = ++sequence;
    active.set(token, String(message || 'Carregando…'));
    render();
    return token;
  }

  function update(token, message) {
    if (!active.has(token)) return;
    active.set(token, String(message || 'Carregando…'));
    render();
  }

  function stop(token) {
    active.delete(token);
    render();
  }

  function setButton(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>' +
        String(busyLabel || 'Aguarde…');
      return;
    }

    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.idleHtml) {
      button.innerHTML = button.dataset.idleHtml;
      delete button.dataset.idleHtml;
    }
  }

  async function run(task, options) {
    const opts = options || {};
    const token = start(opts.message);
    setButton(opts.button, true, opts.buttonLabel);
    try {
      return await (typeof task === 'function' ? task() : task);
    } finally {
      setButton(opts.button, false);
      stop(token);
    }
  }

  window.Loading = { start, update, stop, setButton, run };

  const currentScriptUrl = document.currentScript && document.currentScript.src;
  if ('serviceWorker' in navigator && currentScriptUrl && /^https?:/i.test(location.protocol)) {
    window.addEventListener('load', function () {
      const workerUrl = new URL('../service-worker.js', currentScriptUrl);
      navigator.serviceWorker.register(workerUrl.href, { scope: new URL('../', currentScriptUrl).pathname })
        .catch(function () { /* O app continua normalmente quando o cache offline não está disponível. */ });
    }, { once: true });
  }
})();
