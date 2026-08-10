import { lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routeDirectories = ['setores', 'img'].map((name) => {
  const directory = resolve(repositoryRoot, name);
  const realDirectory = realpathSync(directory);
  if (lstatSync(directory).isSymbolicLink() || realDirectory !== directory) {
    throw new Error(`A pasta ${name} precisa ser uma pasta real dentro do repositório.`);
  }
  return realDirectory;
});

const routes = Object.freeze({
  'monitoria-escolar': 'Monitoria Escolar',
  'residencial-feminino': 'Residencial Feminino',
  academia: 'Academia',
  capelania: 'Capelania',
  coral: 'Coral',
  'e-class': 'e-Class',
  enfermaria: 'Enfermaria',
  esporte: 'Esporte',
  hotelaria: 'Hotelaria',
  jardim: 'Jardim',
  audiovisual: 'Audiovisual',
  marketing: 'Marketing',
  pastoral: 'Pastoral',
  restaurante: 'Restaurante',
  secretaria: 'Secretaria',
  'r-h': 'R.H.',
  contabilidade: 'Contabilidade',
  projeto: 'Projeto',
  'residencial-masculino': 'Residencial Masculino',
  'coordenacao-pedagogica': 'Coordenação Pedagógica',
  trainee: 'Trainee'
});

for (const routeDirectory of routeDirectories) {
  for (const [slug, project] of Object.entries(routes)) {
    const target = resolve(join(routeDirectory, `${slug}.html`));
    if (dirname(target) !== routeDirectory) throw new Error(`Destino inválido: ${target}`);
    const destination = `../chamada.html?projeto=${encodeURIComponent(project)}`;
    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${destination}">
  <title>${project} • Redirecionando</title>
  <link rel="canonical" href="${destination}">
</head>
<body>
  <p>Redirecionando para <a href="${destination}">${project}</a>…</p>
  <script>location.replace(${JSON.stringify(destination)});<\/script>
</body>
</html>
`;
    writeFileSync(target, html, 'utf8');
  }
}

console.log(`${Object.keys(routes).length * routeDirectories.length} rotas de compatibilidade atualizadas.`);
