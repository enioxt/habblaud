import { describe, expect, it } from 'vitest';
import type { Activity } from '../../shared/types';
import { docDoAgente } from './hq-doc';

const act = (p: Partial<Activity>): Activity => ({ id: 'x', kind: 'read', icon: '📖', text: 'Lendo', at: 0, ...p });

describe('ponte agente -> HQ', () => {
  it('caminho indexável na ação atual: devolve o link do documento no HQ', () => {
    const d = docDoAgente({ activity: act({ detail: '/home/u/.egos/relatorios/2026-10-14-plano.md' }), recent: [] });
    expect(d?.nome).toBe('2026-10-14-plano.md');
    expect(d?.url).toBe('http://127.0.0.1:4700/hq/documentos/?q=2026-10-14-plano.md');
  });
  it('caminho só nas recentes (docs do kernel): usa a mais recente', () => {
    const d = docDoAgente({ activity: act({ detail: 'npm test' }), recent: [act({ detail: '/home/u/egos/docs/SYSTEM_MAP.md' }), act({ detail: '/home/u/egos/docs/ROADMAP.md' })] });
    expect(d?.nome).toBe('ROADMAP.md');
  });
  it('sem caminho indexável: sem botão', () => {
    expect(docDoAgente({ activity: act({ detail: 'npm test' }), recent: [act({ detail: '/home/u/proj/src/app.ts' }), act({ detail: '/tmp/x/docs/a.md' })] })).toBeUndefined();
    expect(docDoAgente(undefined)).toBeUndefined();
  });
});
