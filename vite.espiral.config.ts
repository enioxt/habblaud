import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Aviso da licença MIT no topo do JS servido (entra depois da compactação, que apagaria comentário comum).
const LICENCA = `/*! Visual da espiral baseado no Habblaud (github.com/marmottajr/habblaud, MIT).\n${readFileSync(r('./LICENSE'), 'utf8').trim().replace(/\*\//g, '* /')}\n*/`;

/** Só neste pacote: o import './assets' de world/index.ts vira client/src/espiral/assets-empacotados.ts. */
function assetsEmpacotados(): Plugin {
  const mundo = r('./client/src/world/index.ts');
  const troca = r('./client/src/espiral/assets-empacotados.ts');
  return {
    name: 'espiral-assets-empacotados',
    enforce: 'pre',
    resolveId(fonte, importador) {
      if (fonte === './assets' && importador?.split('?')[0] === mundo) return troca;
      return null;
    },
  };
}

// Página web da espiral coletiva: só mundo + arte + store da espiral + painel. Gera dist-espiral/ com nomes por hash
// e caminhos relativos (base './'), para ser servido em qualquer subcaminho (ex.: /espiralcoletiva/visual/).
export default defineConfig({
  root: r('./client'),
  base: './',
  publicDir: false,
  resolve: { alias: [{ find: /^\.\/locales\/all$/, replacement: r('./shared/locales/none.ts') }] },
  plugins: [assetsEmpacotados()],
  build: {
    outDir: r('./dist-espiral'),
    emptyOutDir: true,
    assetsDir: 'bundle',
    assetsInlineLimit: 0,
    sourcemap: false,
    modulePreload: { polyfill: false },
    // postBanner entra depois da compactação e antes do hash: o nome do arquivo cobre o aviso.
    rolldownOptions: { input: { espiral: r('./client/espiral.html') }, output: { postBanner: LICENCA } },
  },
});
