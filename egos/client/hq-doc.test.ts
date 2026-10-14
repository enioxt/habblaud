import { describe, expect, it } from 'vitest';
import type { Activity } from '../../shared/types';
import { abrirNaMoldura, docDoAgente } from './hq-doc';

const act = (p: Partial<Activity>): Activity => ({ id: 'x', kind: 'read', icon: '📖', text: 'Lendo', at: 0, ...p });

describe('ponte agente -> HQ', () => {
  it('caminho indexável na ação atual: devolve o link do documento no HQ', () => {
    const d = docDoAgente({ activity: act({ detail: '/home/u/.egos/relatorios/2026-10-14-plano.md' }), recent: [] });
    expect(d?.nome).toBe('2026-10-14-plano.md');
    expect(d?.url).toBe('http://127.0.0.1:4700/hq/documentos/?publico=tudo&q=2026-10-14-plano');
  });
  it("caminho relativo à home, como o agente escreve: Path.home()/'.egos/relatorios/…'", () => {
    const d = docDoAgente({ activity: act({ detail: "python3 - <<'PY' p=Path.home()/'.egos/relatorios/2026-10-14-x.md' s='''" }), recent: [] });
    expect(d?.nome).toBe('2026-10-14-x.md');
  });
  it('caminho só nas recentes (docs do kernel): usa a mais recente', () => {
    const d = docDoAgente({ activity: act({ detail: 'npm test' }), recent: [act({ detail: '/home/u/egos/docs/SYSTEM_MAP.md' }), act({ detail: '/home/u/egos/docs/ROADMAP.md' })] });
    expect(d?.nome).toBe('ROADMAP.md');
  });
  it('sem caminho indexável: sem botão', () => {
    expect(docDoAgente({ activity: act({ detail: 'npm test' }), recent: [act({ detail: "p=Path.home()/'.egos/relatorios/revisao-codex/a.md'" }), act({ detail: '/home/u/proj/src/app.ts' }), act({ detail: '/tmp/x/docs/a.md' })] })).toBeUndefined();
    expect(docDoAgente(undefined)).toBeUndefined();
  });
});

describe('clique em "abrir no HQ" dentro da moldura lado a lado', () => {
  const url = 'http://127.0.0.1:4700/hq/documentos/?publico=tudo&q=plano';
  it('enquadrado: manda a mensagem só para a origem do HQ e avisa que tratou', () => {
    const enviadas: [unknown, string][] = [];
    const janela = { parent: { postMessage: (m: unknown, o: string) => enviadas.push([m, o]) } as unknown as Window, self: null as unknown as Window };
    janela.self = {} as Window;
    expect(abrirNaMoldura(janela, url)).toBe(true);
    expect(enviadas).toEqual([[{ tipo: 'egos:abrir-doc', url }, 'http://127.0.0.1:4700']]);
  });
  it('fora de moldura (parent é a própria janela): não trata, o link abre em aba como antes', () => {
    const w = { postMessage: () => { throw new Error('não devia'); } } as unknown as Window;
    expect(abrirNaMoldura({ parent: w, self: w }, url)).toBe(false);
  });
  it('url que não é do HQ: não manda nada', () => {
    const enviadas: unknown[] = [];
    const janela = { parent: { postMessage: (m: unknown) => enviadas.push(m) } as unknown as Window, self: {} as Window };
    expect(abrirNaMoldura(janela, 'https://evil.example/hq/documentos/')).toBe(false);
    expect(enviadas).toEqual([]);
  });
});
