// API de perfis, autenticação e gestão de acessos.
// Troque a URL abaixo se você implantar uma nova versão do Web App.
//
// GOOGLE_CLIENT_ID é o Client ID OAuth 2.0 (tipo "Aplicativo da Web") usado pelo
// botão "Entrar com o Google". Ele é público por natureza — o que protege o
// sistema é o Apps Script conferir o token no Google e exigir que o e-mail já
// esteja cadastrado em USERS. O mesmo valor precisa estar na propriedade de
// script GOOGLE_CLIENT_ID do Apps Script de perfis, senão o login é recusado.
window.PROFILE_APP_CONFIG = Object.freeze({
  API_URL: "https://script.google.com/macros/s/AKfycbxmT11Whtdb0YWb8sJ9XPonhUg6sIBg-fu0oLFqJparPAUAT2XQll3OFKizFSbp2usMmQ/exec",
  GOOGLE_CLIENT_ID: "611072302986-lsk02a3590hnub6u9kq1jonhr65tc7ec.apps.googleusercontent.com",
  APP_NAME: "IAPE • Gestão Estudantil",
  THEME_COLOR: "#12365d"
});
