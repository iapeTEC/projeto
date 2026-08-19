# IAPE • Gestão Estudantil

Plataforma acadêmica para acompanhar alunos, bolsas, setores, avaliações, projetos e frequência. O frontend é publicado pelo GitHub Pages e os dados são atendidos por Google Apps Script + Google Planilhas.

**Aplicação:** [iapetec.github.io/projeto](https://iapetec.github.io/projeto/)

## Recursos

- Acesso com a conta Google autorizada — sem senha e sem código por e-mail.
- Papéis de proprietário/TI, administrador, editor e usuário.
- Diretório de alunos com filtros, contato e perfil individual.
- Avaliações formativas, histórico de evolução e relatórios para impressão.
- Gestão de setores, bolsas, competências e usuários.
- Lista de chamada com presença, falta e observação.
- Dashboard de faltas com ranking de alunos, setores clicáveis e relatório para impressão.
- Relatório de fichas com foto: você escolhe os alunos, escolhe os campos e imprime seis fichas por folha A4.
- Interface responsiva e instalável como PWA.
- Barra de progresso, spinner, mensagem da operação e bloqueio do botão durante todas as solicitações.

## Arquitetura

O sistema possui dois Apps Scripts independentes. Essa separação foi mantida porque cada módulo tem dados, permissões e responsabilidades diferentes.

| Módulo | Configuração do frontend | Código versionado | Deploy atual |
| --- | --- | --- | --- |
| Perfis, login e avaliações | `assets/config.js` | `appscript/projeto7/Api.js` e `Código.js` | URL definida no config |
| Frequência e dashboard | `assets/config2.js` | `appscript/Code.gs` | URL definida no config |

O frontend usa apenas as URLs estáveis terminadas em `/exec`. URLs temporárias de `script.googleusercontent.com/macros/echo` nunca devem ser copiadas para os arquivos de configuração.

```text
projeto/
├── appscript/
│   ├── projeto7/          # login, perfis, avaliações e cadastros
│   ├── Code.gs            # frequência e dashboard
│   └── appsscript.json
├── assets/                # CSS, API client, loading e componentes compartilhados
├── icons/                 # favicon e manifesto da PWA
├── img/optimized/         # avatares WebP leves
├── setores/               # redirecionamentos de links antigos
├── tests/                 # testes de backend e frontend
├── index.html             # visão geral acadêmica
├── students.html          # diretório de alunos
├── student.html           # perfil e evolução individual
├── editor.html            # gestão acadêmica
├── escolhersetores.html   # seleção do projeto
├── chamada.html           # frequência
├── dashboard.html         # indicadores e relatório de faltas
└── fichas.html            # relatório de fichas com foto e seleção de alunos
```

## Desempenho

As telas continuam sujeitas ao tempo de inicialização a frio do Apps Script, mas agora realizam muito menos execuções e deixam claro que a operação está em andamento.

- A visão geral caiu de quatro chamadas ao Apps Script para uma rota agregada.
- O diretório recebe alunos, setores e bolsas em uma única solicitação inicial.
- A busca de alunos acontece no navegador a cada letra digitada e apresenta sugestões sem novas esperas no Apps Script.
- A gestão acadêmica caiu de quatro solicitações iniciais para uma.
- A edição usa uma lista mestre de alunos já carregada: selecionar um nome preenche o formulário imediatamente, sem uma segunda solicitação.
- O identificador interno do aluno nunca precisa ser digitado ou carregado manualmente.
- A edição envia somente os campos modificados e preserva data de nascimento, idade, observações e demais dados não alterados.
- Datas vindas das planilhas são normalizadas antes de chegar aos campos do navegador.
- O perfil individual recebe dados e competências em uma única solicitação.
- Setores, bolsas, competências e configurações usam cache no servidor com invalidação após escrita.
- Alunos, usuários e sessões autenticadas também usam cache curto no Apps Script, evitando releituras repetidas da planilha a cada tela.
- O navegador evita chamadas duplicadas em andamento e reutiliza leituras recentes durante a sessão.
- Em inicializações lentas do Google, o navegador mantém a solicitação ativa por até 90 segundos e informa que continua tentando.
- Projetos e listas de chamada ficam em cache por cinco minutos.
- A substituição de uma chamada remove blocos contíguos de linhas, em vez de apagar uma linha por aluno.
- O dashboard calcula métricas e resumos em uma passagem e mantém um cache curto por filtro.
- A troca entre setores no dashboard usa o resultado já carregado, sem esperar uma nova chamada ao Google.
- Configurações e clientes da API usam atualização pela rede no service worker, evitando JavaScript antigo após uma publicação.
- As 173 fotos possuem versões WebP de 128 px. O conjunto usado nos avatares caiu de aproximadamente 38,7 MB para 315 KB.
- As antigas páginas duplicadas de setores redirecionam para uma única tela parametrizada.
- A primeira chamada de cada tela ao Apps Script parte assim que `assets/api.js` carrega, antes do CSS de terceiros e do script da página. Quem pedir o mesmo par ação+payload depois recebe a mesma promessa, sem requisição extra.
- Bootstrap e Chart.js carregam com `defer`: deixaram de ficar na frente do script que dispara a primeira chamada ao Google.
- As páginas que usam CDN aquecem `cdn.jsdelivr.net` com `preconnect`.
- A tela de acesso não carrega mais Bootstrap: ficaram só o CSS do aplicativo e o cliente do Google.
- O diretório de alunos e o relatório de fichas usam o mesmo par ação+payload e, portanto, o mesmo cache — trocar de tela não custa uma nova leitura da planilha.
- A verificação do ID token do Google fica em cache no Apps Script, então uma sequência de chamadas não paga um `UrlFetch` por requisição.

## Interface

A identidade visual foi refeita para apresentar o sistema como uma plataforma acadêmica institucional:

- tela de acesso responsiva com linguagem educacional;
- navegação consistente entre visão geral, alunos, frequência e gestão;
- hierarquia visual de títulos, indicadores e ações rápidas;
- paleta institucional em azul-marinho, azul e verde;
- diretório com avatares e estados vazios;
- layout adaptado para desktop e celular;
- feedback visual imediato para carregamentos e envios demorados.
- editor acadêmico em fluxo mestre-detalhe, sem janelas sobrepostas, com pesquisa por aluno, setor ou bolsa.
- painel de faltas com prioridade de contato, busca por aluno, filtros rápidos, cartões de setor e relatório impresso.

## Acesso e papéis

O login é feito com a conta Google, no mesmo desenho usado pelo MyTask. A pessoa clica em **Entrar com o Google**, o navegador recebe um ID token do Google Identity Services e o Apps Script confirma esse token direto no Google (`oauth2.googleapis.com/tokeninfo`), conferindo emissor, validade, e-mail verificado e se o token foi emitido para **este** aplicativo. Só depois disso o backend procura o e-mail na aba `USERS`: conta não cadastrada ou desativada não recebe sessão nenhuma.

O sistema nunca vê a senha da pessoa. A sessão continua sendo o mesmo token opaco de antes — guardado apenas na aba atual do navegador e gravado como hash na planilha —, então o módulo de frequência segue validando exatamente como já validava.

O login por código de e-mail saiu da tela, mas as rotas `requestLoginCode`/`verifyLoginCode` continuam no Apps Script como resgate caso o acesso Google fique indisponível.

O proprietário inicial é `normafederal@gmail.com`. Ele é criado automaticamente e de forma idempotente na primeira solicitação de código. Na área **Gestão → Acessos**, somente esse proprietário pode cadastrar e-mails, alterar papéis, ativar/desativar contas e revogar sessões.

| Papel | Permissões |
| --- | --- |
| `OWNER` | TI/proprietário: todos os recursos e gestão de acessos |
| `ADMIN` | Gestão acadêmica, configurações, chamadas e relatórios |
| `EDITOR` | Edição acadêmica, chamadas e relatórios |
| `USER` | Consultas, perfis e dashboard de faltas |

### Configurar o login Google

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha **Aplicativo da Web**.
2. Em **Origens JavaScript autorizadas**, informe `https://iapetec.github.io` (e `http://localhost:8080` para testar na máquina). Este fluxo não usa redirecionamento, então **URIs de redirecionamento** pode ficar vazio.
3. Copie o Client ID gerado para os **dois** lugares, com o mesmo valor:
   - `assets/config.js`, em `GOOGLE_CLIENT_ID`;
   - Apps Script de perfis, em **Configurações do projeto → Propriedades do script**, na propriedade `GOOGLE_CLIENT_ID`.
4. Publique uma nova versão do Web App de perfis e um novo deploy do GitHub Pages.

O Client ID é público por natureza — quem protege o sistema é a conferência do token no Google somada à exigência de cadastro prévio em `USERS`. Guardar o mesmo valor nos dois lados é o que garante que um token emitido para outro aplicativo seja recusado.

Se o envio de código for reativado como resgate, o proprietário do Apps Script precisa executar `authorizeMailForLogin()` uma vez no editor. A função abre o consentimento do `MailApp`, confirma a cota e não envia mensagem.

## Apps Script

### Frequência

O backend lê estas propriedades privadas em **Configurações do projeto → Propriedades do script**:

- `ATTENDANCE_SPREADSHEET_ID`
- `SOURCE_ROSTER_SPREADSHEET_ID`
- `ADMIN_TOKEN` (opcional, recomendado para a ação administrativa via HTTP)

`SOURCE_ROSTER_SPREADSHEET_ID` deve apontar para a mesma planilha que contém `STUDENTS`, `SECTORS`, `USERS` e `SESSIONS`. Assim, o módulo de frequência valida as mesmas sessões do módulo de perfis. Leituras aceitam `OWNER`, `ADMIN`, `EDITOR` e `USER`; somente `OWNER`, `ADMIN` e `EDITOR` podem registrar chamadas.

Funções administrativas disponíveis no editor:

- `configurarProjeto_()` — valida as abas e limpa os caches;
- `instalarTriggerPresencaAutomatica_()` — instala o processamento diário às 18h;
- `limparCaches_()` — força a atualização de alunos e responsáveis.

### Perfis e avaliações

Execute `setupScholarshipSystem()` somente ao preparar uma planilha nova. Em uma base existente, a primeira solicitação de código executa uma migração aditiva das abas `USERS` e `SESSIONS`, cria `AUTH_AUDIT`, revoga as sessões antigas e garante o proprietário `normafederal@gmail.com`. Não configure senha inicial.

### Sincronização com `clasp`

Os arquivos `.clasp.json` reais e as credenciais OAuth são ignorados pelo Git. Nunca publique `.clasprc.json`, senhas ou tokens.

```bash
npm install -g @google/clasp
clasp login

# dentro da pasta vinculada ao Apps Script
clasp pull
clasp push
clasp version "descrição da versão"
clasp deployments
```

Antes de enviar alterações, faça `clasp pull` em uma pasta limpa ou revise o projeto remoto para evitar sobrescrever trabalho não versionado.

## Desenvolvimento local

Requer Node.js 20 ou superior. Para servir o frontend:

```bash
python3 -m http.server 8080
```

Acesse `http://localhost:8080/login.html` ou `http://localhost:8080/escolhersetores.html`.

Execute a validação completa com:

```bash
npm test
```

Os testes verificam sintaxe, rotas agregadas, segurança do usuário inicial, cache do Apps Script, links locais, indicadores de carregamento, redirecionamentos antigos e imagens otimizadas.

## Segurança

- Não publique planilhas, senhas, tokens de sessão, credenciais OAuth ou dados pessoais exportados.
- Perfis, diretório, dashboard e chamada exigem uma sessão válida.
- O módulo de frequência valida o hash da sessão diretamente nas abas `USERS` e `SESSIONS`; escrita nunca usa cache de autorização.
- Somente o proprietário pode conceder ou remover acessos.
- Códigos de login têm expiração, limite de tentativas, intervalo de reenvio, teto global de envio e resposta que não revela se um e-mail está cadastrado.
- As antigas senhas e sessões em texto puro são removidas/revogadas pela migração.

---

Desenvolvido e mantido por **Bruno Agostinho**.
