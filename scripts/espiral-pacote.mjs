// ESPIRAL (visual web): gera dist-espiral/ (vite build), copia a licença, escreve PROVENIENCIA.txt e roda a varredura.
// Uso: npm run build:espiral
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(RAIZ, 'dist-espiral');
const COMANDO = 'node_modules/.bin/vite build --config vite.espiral.config.ts';
const git = (...a) => execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8' }).trim();

const commit = git('rev-parse', 'HEAD');
const ramo = git('rev-parse', '--abbrev-ref', 'HEAD');
const sujos = git('status', '--porcelain', '--untracked-files=all').split('\n').filter((l) => l && !/ (dist-espiral\/|node_modules$)/.test(l));

execFileSync(join(RAIZ, 'node_modules/.bin/vite'), ['build', '--config', 'vite.espiral.config.ts'], { cwd: RAIZ, stdio: 'inherit' });
copyFileSync(join(RAIZ, 'LICENSE'), join(DIST, 'LICENSE.txt'));

const arquivos = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? arquivos(join(d, n)) : [join(d, n)]));
const linhas = arquivos(DIST)
  .map((p) => relative(DIST, p))
  .filter((r) => r !== 'PROVENIENCIA.txt')
  .sort()
  .map((r) => {
    const b = readFileSync(join(DIST, r));
    return `${createHash('sha256').update(b).digest('hex')}  ${b.length}  ${r}`;
  });
const versao = (m) => JSON.parse(readFileSync(join(RAIZ, 'node_modules', m, 'package.json'), 'utf8')).version;

const texto = `PROVENIENCIA do visual web da espiral coletiva
gerado em: ${new Date().toISOString()}
repositório: fork enioxt/habblaud (licença MIT; original marmottajr/habblaud)
ramo: ${ramo}
commit do fork: ${commit}
árvore de trabalho limpa na geração: ${sujos.length ? 'NÃO (' + sujos.length + ' arquivo(s) alterado(s))' : 'sim'}
base: egos/main 4682cbd (sem a versão nova do original, que manda dado ao servidor do autor)
comando: ${COMANDO}  (via: npm run build:espiral)
ferramentas: node ${process.versions.node}, vite ${versao('vite')}
licença: LICENSE.txt (cópia do LICENSE do fork) e aviso MIT no topo de cada JS

entra no pacote: client/src/world (mundo), client/src/art (arte), shared/ (tipos, hash, aparência, i18n em pt-BR),
  egos/client/modo-real.ts e egos/client/frases.ts (o mundo importa), pinturas de client/public/assets/art e a placa
  e a marca de client/public/assets/brand; código novo em client/src/espiral (store da espiral, painel, conversão).
fica de fora: client/src/ui, client/src/net (store do servidor local), client/src/audio, server/, egos/client/economia.ts
  e o resto da camada egos/client, dicionários en/es/fr, client/public (manifesto, ilustrações, ícones).

sha256  bytes  arquivo
${linhas.join('\n')}
`;
writeFileSync(join(DIST, 'PROVENIENCIA.txt'), texto);
console.log(texto);

execFileSync(join(RAIZ, 'node_modules/.bin/vitest'), ['run', 'client/src/espiral'], { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, ESPIRAL_PACOTE: '1' } });
