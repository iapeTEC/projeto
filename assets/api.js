(function(){
  function getConfig(){
    if(!window.APP_CONFIG || !window.APP_CONFIG.API_URL){
      throw new Error("APP_CONFIG não definido (assets/config.js).");
    }
    return window.APP_CONFIG;
  }

  function getToken(){
    return localStorage.getItem("session_token") || "";
  }

  function getUser(){
    const raw = localStorage.getItem("session_user");
    if(!raw) return null;
    try { return JSON.parse(raw); } catch(e){ return null; }
  }

  function setSession(token, user, expiresAt){
    localStorage.setItem("session_token", token || "");
    localStorage.setItem("session_user", JSON.stringify(user || {}));
    if(expiresAt) localStorage.setItem("session_expires_at", expiresAt);
  }

  function clearSession(){
    localStorage.removeItem("session_token");
    localStorage.removeItem("session_user");
    localStorage.removeItem("session_expires_at");
  }

  async function apiPost(action, payload){
    const cfg = getConfig();
    const body = Object.assign({}, payload || {});
    body.action = action;
    // token no body (padrão do projeto)
    if(action !== "login"){
      body.token = body.token || getToken();
    }

    const res = await fetch(cfg.API_URL, {
      method: "POST",
      headers: { "Content-Type":"text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow"
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch(e){
      // resposta não-JSON (ex.: HTML por erro de deploy)
      throw new Error("Resposta inesperada (não JSON). Verifique o deploy/URL. Trecho: " + text.slice(0, 180));
    }

    if(!data || data.ok !== true){
      const msg = (data && data.error) ? data.error : "Erro desconhecido";
      throw new Error(msg);
    }
    return data;
  }

  function fmtDate(iso){
    if(!iso) return "";
    // aceita yyyy-mm-dd ou datetime
    const s = String(iso).slice(0, 10);
    const parts = s.split("-");
    if(parts.length !== 3) return s;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function esc(s){
    return String(s||"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  window.Api = {
    apiPost,
    getToken,
    getUser,
    setSession,
    clearSession,
    fmtDate,
    esc
  };
})(); 
