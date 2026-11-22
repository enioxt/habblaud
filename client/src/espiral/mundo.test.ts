// ESPIRAL (visual web): o mundo da espiral nunca toca no armazenamento do navegador.
// Motivo: a página roda na mesma origem do site; o que o mundo grava (carteiras do Habblaud: número da conta, nome da
// sala e apelido de cada agente) ficaria no aparelho depois do logout ou da revogação e seria legível por qualquer
// outra página da mesma origem. Aqui o localStorage é um espião: qualquer leitura ou escrita reprova.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfficeSnapshot } from '../../../shared/types';
import { modoReal } from '../../../egos/client/modo-real';
import { criarMundoEspiral } from './mundo';

afterEach(() => vi.unstubAllGlobals());

function ambiente() {
  const acessos: string[] = [];
  const espiao = {
    getItem: (k: string) => (acessos.push('get ' + k), null),
    setItem: (k: string) => void acessos.push('set ' + k),
    removeItem: (k: string) => void acessos.push('remove ' + k),
    key: () => null,
    clear: () => void acessos.push('clear'),
    length: 0,
  };
  vi.stubGlobal('localStorage', espiao);
  vi.stubGlobal('sessionStorage', espiao);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { fonts: new EventTarget(), hidden: false }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  const canvas = Object.assign(new EventTarget(), { clientWidth: 800, clientHeight: 600, width: 800, height: 600, style: {}, getContext: () => ({}) }) as unknown as HTMLCanvasElement;
  return { acessos, canvas };
}

describe('mundo da espiral sem armazenamento do navegador', () => {
  it('criar, trocar o relógio (refaz a simulação) e desmontar não leem nem gravam nada no localStorage', () => {
    const { acessos, canvas } = ambiente();
    const ouvintes = new Set<() => void>();
    const store = { snapshot: null as OfficeSnapshot | null, on: (_e: 'snapshot', cb: () => void) => (ouvintes.add(cb), () => void ouvintes.delete(cb)) };
    const mundo = criarMundoEspiral(canvas, store);
    store.snapshot = { rev: 1, serverTime: Date.now(), rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: 0, version: 'espiral' } };
    for (const cb of ouvintes) cb();
    mundo.setPlayback?.({ clock: () => Date.now(), scale: () => 1 });
    mundo.setPlayback?.(null);
    mundo.destroy();
    expect(acessos).toEqual([]);
  });
});

describe('mundo da espiral só com o que é real (E4)', () => {
  it('criar o mundo liga o modo real: nada de apostas nem falas inventadas', () => {
    const { canvas } = ambiente();
    modoReal.ligado = false;
    const store = { snapshot: null as OfficeSnapshot | null, on: (_e: 'snapshot', _cb: () => void) => () => {} };
    const mundo = criarMundoEspiral(canvas, store);
    expect(modoReal.ligado).toBe(true);
    mundo.destroy();
  });
});
