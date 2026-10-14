import { describe, expect, it } from 'vitest';
import type { Activity } from '../../shared/types';
import { atividadeReal, fraseReal, mensagemDoCommit, ociosoHa } from './frases';
import { agruparVps } from './vps-chip';

const act = (p: Partial<Activity>): Activity => ({ id: 'x', kind: 'run', icon: '▶️', text: 'Rodando', at: 0, ...p });

describe('frases reais do balão', () => {
  it('commit: mensagem tirada do comando, nunca inventada', () => {
    expect(mensagemDoCommit('git commit -m "fix(lei): grava regra"')).toBe('fix(lei): grava regra');
    expect(mensagemDoCommit("git add a && git commit -q -m 'feat: x'")).toBe('feat: x');
    expect(mensagemDoCommit("git commit -m \"$(cat <<'EOF'\nfeat(y): z\n\ncorpo\nEOF\n)\"")).toBe('feat(y): z');
    expect(fraseReal(act({ kind: 'git', detail: 'git commit -m "fix(lei): grava regra"' }))?.text).toBe('Commit: fix(lei): grava regra');
    expect(fraseReal(act({ kind: 'git', detail: 'git commit -m "x"', error: true }))?.text).toBe('Commit falhou: x');
  });
  it('PR: número só quando está no comando', () => {
    expect(fraseReal(act({ kind: 'git', detail: 'gh pr merge 806 --squash' }))?.text).toBe('Mesclando PR #806');
    expect(fraseReal(act({ kind: 'git', detail: 'gh pr create --title "feat: placar" --body x' }))?.text).toBe('Abrindo PR: feat: placar');
    expect(fraseReal(act({ kind: 'git', detail: 'gh pr checks' }))?.text).toBe('Conferindo o CI do PR');
  });
  it('testes e leitura levam o nome da sala; sem contagem que o evento não traz', () => {
    expect(fraseReal(act({ kind: 'test', detail: 'npm test' }), { sala: 'Guard' })?.text).toBe('Rodando testes · Guard');
    expect(fraseReal(act({ kind: 'test', error: true }), { sala: 'Guard' })?.text).toBe('Testes falharam · Guard');
    expect(fraseReal(act({ kind: 'read', text: 'Lendo office.ts', icon: '📖' }), { sala: 'Sala A' })).toEqual({ icon: '📖', text: 'Lendo office.ts · Sala A' });
    expect(fraseReal(act({ kind: 'think', text: 'Pensando' }))).toBeUndefined();
  });
  it('atividadeReal devolve o mesmo objeto enquanto nada muda', () => {
    const a = act({ kind: 'read', text: 'Lendo a.ts' });
    expect(atividadeReal(a, 'S')).toBe(atividadeReal(a, 'S'));
    expect(atividadeReal(a, 'S')?.text).toBe('Lendo a.ts · S');
  });
  it('ocioso há X min', () => {
    expect(ociosoHa(0, 1)).toBeUndefined();
    expect(ociosoHa(1_000, 1_000 + 12 * 60_000)).toBe('ocioso há 12 min');
    expect(ociosoHa(1, 1 + 75 * 60_000)).toBe('ocioso há 1 h 15 min');
  });
});

describe('chip VPS', () => {
  const contas = [{ id: '.claude' }, { id: '.vps-claude-a' }, { id: '.vps-codex-b' }, { id: '.codex-enio' }];
  it('agrupa as contas da VPS quando há 2 ou mais; aberto mostra todas', () => {
    expect(agruparVps(contas, false).visiveis.map((a) => a.id)).toEqual(['.claude', '.codex-enio']);
    expect(agruparVps(contas, false).vps).toHaveLength(2);
    expect(agruparVps(contas, true).visiveis).toHaveLength(4);
    expect(agruparVps(contas.slice(0, 2), false).vps).toEqual([]);
  });
});
