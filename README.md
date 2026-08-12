# IAPE • Gestão Estudantil

Plataforma acadêmica para acompanhar alunos, bolsas, setores, avaliações, projetos e frequência. O frontend é publicado pelo GitHub Pages e os dados são atendidos por Google Apps Script + Google Planilhas.

**Aplicação:** [iapetec.github.io/projeto](https://iapetec.github.io/projeto/)

## Recursos

- Autenticação com perfis de administrador e consulta.
- Diretório de alunos com filtros, contato e perfil individual.
- Avaliações formativas, histórico de evolução e relatórios para impressão.
- Gestão de setores, bolsas, competências e usuários.
- Lista de chamada com presença, falta e observação.
- Dashboard de frequência por período e projeto.
- Interface responsiva e instalável como PWA.
- Barra de progresso, spinner, mensagem da operação e bloqueio do botão durante todas as solicitações.

## Arquitetura

O sistema possui dois Apps Scripts independentes. Essa separação foi mantida porque cada módulo tem dados, permissões e responsabilidades diferentes.

| Módulo | Configuração do frontend | Código versionado | Deploy atual |
| --- | --- | --- | --- |
| Perfis, login e avaliações | `assets/config.js` | `appscript/projeto7/Api.js` e `Código.js` | versão 11 |
| Frequência e dashboard | `assets/config2.js` | `appscript/Code.gs` | versão 6 |

As duas URLs existentes foram preservadas durante a atualização. O código foi publicado sobre as implantações atuais, evitando quebrar favoritos ou links já distribuídos.

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
└── dashboard.html         # indicadores de frequência
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
- As 173 fotos possuem versões WebP de 128 px. O conjunto usado nos avatares caiu de aproximadamente 38,7 MB para 315 KB.
- As antigas páginas duplicadas de setores redirecionam para uma única tela parametrizada.

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

## Apps Script

### Frequência

O backend lê estas propriedades privadas em **Configurações do projeto → Propriedades do script**:

- `ATTENDANCE_SPREADSHEET_ID`
- `SOURCE_ROSTER_SPREADSHEET_ID`
- `ADMIN_TOKEN` (opcional, recomendado para a ação administrativa via HTTP)

Os IDs usados pela implantação foram migrados para as propriedades do Apps Script e não ficam no código público.

Funções administrativas disponíveis no editor:

- `configurarProjeto_()` — valida as abas e limpa os caches;
- `instalarTriggerPresencaAutomatica_()` — instala o processamento diário às 18h;
- `limparCaches_()` — força a atualização de alunos e responsáveis.

### Perfis e avaliações

Execute `setupScholarshipSystem()` somente ao preparar uma planilha nova. Para criar o primeiro usuário sem senha exposta no código:

1. Defina temporariamente `INITIAL_USER_LOGIN`, `INITIAL_USER_PASSWORD` e `INITIAL_USER_ROLE` nas propriedades do script.
2. Execute `seedInitialUserFromProperties()`.
3. A propriedade com a senha será removida automaticamente após a criação.

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
- A área de perfis exige sessão e papel de acesso.
- A API de frequência permanece acessível anonimamente para ser compatível com o fluxo atual. Para uso fora da equipe, recomenda-se adicionar autenticação institucional também a esse módulo.
- As antigas rotinas com senhas padrão foram removidas do código versionado.

---

Desenvolvido e mantido por **Bruno Agostinho**.
