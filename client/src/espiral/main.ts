// ESPIRAL (visual web): ponto de entrada da página da espiral. Monta SÓ o mundo (client/src/world) e a arte
// (client/src/art) do Habblaud, com o store alimentado pela API da espiral e um painel próprio. Fica de fora:
// client/src/ui, client/src/net/store.ts, server/ e a camada egos/client de economia (ver PROVENIENCIA.txt).
import './espiral.css';
import { criarMundoEspiral } from './mundo';
import { montarPainel } from './painel';
import { EspiralStore } from './store';

const canvas = document.getElementById('mundo');
const painel = document.getElementById('painel');
if (canvas instanceof HTMLCanvasElement && painel) {
  const store = new EspiralStore();
  const world = criarMundoEspiral(canvas, store);
  const estreita = window.matchMedia('(max-width: 720px)');
  const margens = () => world.setViewInsets?.(estreita.matches ? { right: 0, bottom: painel.offsetHeight } : { right: painel.offsetWidth, bottom: 0 });
  estreita.addEventListener('change', margens);
  window.addEventListener('resize', margens);
  montarPainel(painel, store, world);
  margens();
  store.start(15_000);
}
