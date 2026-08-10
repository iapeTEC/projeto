# Projetos • Gestão de Alunos

Plataforma web para acompanhar alunos, seus perfis, avaliações e a frequência nos projetos vespertinos. O frontend é publicado pelo GitHub Pages e usa Google Apps Script + Google Planilhas como backend.

**Aplicação:** [iapetec.github.io/projeto](https://iapetec.github.io/projeto/)

## O que existe no sistema

- Área autenticada de perfis, filtros, relatórios e avaliações de alunos.
- Lista de chamada única para todos os projetos, com presença, falta e observação.
- Dashboard por período e projeto, com indicadores e relatório de faltas para impressão.
- Interface responsiva, instalável como PWA e com cache de arquivos estáticos.
- Indicadores visuais em todas as solicitações: barra de progresso, spinner, mensagem da etapa e botões bloqueados durante o envio.

## Arquitetura importante

Este repositório usa **dois deploys diferentes do Apps Script**:

| Módulo | Configuração do frontend | Backend no repositório |
| --- | --- | --- |
| Perfis, login e avaliações | `assets/config.js` | Ainda não está versionado |
| Frequência e dashboard | `assets/config2.js` | `appscript/Code.gs` |

O `Code.gs` fornecido originalmente corresponde ao segundo módulo. A URL de `config.js` é diferente, portanto existe outro projeto Apps Script para a área de perfis. Faça uma cópia dos demais arquivos `.gs` desse projeto e adicione-os ao repositório antes de alterar seu backend. Dentro de um mesmo projeto Apps Script, todos os arquivos `.gs` funcionam em conjunto; deve existir apenas uma implementação ativa de cada `doGet` e `doPost`.

```text
projeto/
├── appscript/              # backend de frequência versionado
├── assets/                 # CSS e JavaScript compartilhados
├── icons/                  # ícones e manifesto PWA
├── img/
│   └── optimized/          # avatares WebP leves
├── setores/                # compatibilidade com links antigos
├── tests/                  # testes sem dependências externas
├── chamada.html           # chamada parametrizada por projeto
├── escolhersetores.html   # seletor de projetos
├── dashboard.html         # indicadores de frequência
└── login.html / index.html / students.html / student.html / editor.html
```

## Melhorias de desempenho

A versão 2 reduz o tempo percebido e o volume transferido de várias formas:

- O frontend de perfis executa leituras independentes em paralelo e reutiliza metadados estáveis durante a sessão.
- Projetos e listas de alunos ficam em cache por cinco minutos no navegador e no Apps Script.
- O dashboard usa uma única solicitação inicial e limita os lançamentos enviados para a tela.
- O backend não abre nem valida planilhas que uma rota não utiliza.
- A substituição de uma chamada apaga blocos contíguos de linhas, em vez de executar um `deleteRow` para cada aluno.
- Os resumos são calculados em uma única passagem pelos dados.
- As 173 fotos ganharam versões WebP de 128 px: o conjunto usado pelos avatares caiu de aproximadamente **38,7 MB para 315 KB** (mais de 99% de redução). Os PNGs originais continuam como fallback.
- As antigas páginas duplicadas de setores agora redirecionam para `chamada.html?projeto=...`, mantendo os links existentes.

O tempo frio do Apps Script ainda depende da infraestrutura do Google. Antes desta revisão, as medições do deploy atual ficaram em torno de 12–14 segundos por solicitação; por isso, reduzir a quantidade de solicitações e sempre mostrar o andamento é tão importante quanto otimizar o código do servidor.

## Configurar o Apps Script de frequência

1. Faça backup do projeto Apps Script que atende `assets/config2.js`.
2. Copie [`appscript/Code.gs`](appscript/Code.gs) para esse projeto.
3. Em **Configurações do projeto → Propriedades do script**, cadastre:

   - `ATTENDANCE_SPREADSHEET_ID`: ID da planilha que contém `Attendance`.
   - `SOURCE_ROSTER_SPREADSHEET_ID`: ID da planilha que contém `STUDENTS` e `SECTORS`.
   - `ADMIN_TOKEN`: valor longo e aleatório para proteger a execução automática via HTTP (opcional, mas recomendado).

4. Confirme o fuso horário `America/Recife`.
5. Execute `configurarProjeto_` uma vez no editor e autorize o acesso às planilhas.
6. Se desejar a presença automática às 18h, execute `instalarTriggerPresencaAutomatica_` uma vez.
7. Crie uma **nova versão** do deploy como aplicativo da web, executando como o proprietário. Atualize `assets/config2.js` somente se a URL mudar.

Os IDs das planilhas não ficam mais expostos no repositório público. Eles são lidos das Propriedades do script.

### Atualizar com clasp (opcional)

```bash
npm install -g @google/clasp
cd appscript
cp .clasp.json.example .clasp.json
# informe o scriptId real em .clasp.json
clasp login
clasp push
```

O arquivo `.clasp.json` real está ignorado pelo Git para não publicar o ID do projeto.

## Desenvolvimento local

Não abra os HTMLs diretamente com `file://`, pois o service worker e algumas regras do navegador precisam de HTTP:

```bash
python3 -m http.server 8080
```

Depois acesse `http://localhost:8080/escolhersetores.html`.

Para validar sintaxe, links locais, rotas antigas, imagens otimizadas e helpers do Apps Script:

```bash
npm test
```

Para regerar as páginas de compatibilidade depois de alterar projetos:

```bash
npm run generate:routes
```

## Segurança e dados

- A área de perfis usa token, mas o código do backend de autenticação ainda precisa ser versionado e auditado.
- A API de frequência atualmente é publicada para acesso anônimo; qualquer pessoa que conheça a URL pode consultar nomes e tentar enviar dados. Para dados reais de alunos, recomenda-se migrar esse módulo para autenticação do Google Workspace ou para o mesmo controle de sessão da área de perfis.
- Não publique senhas, tokens administrativos, IDs de planilhas ou exportações com dados pessoais.

---

Desenvolvido e mantido por **Bruno Agostinho**.
