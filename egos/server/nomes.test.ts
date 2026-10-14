import { describe, expect, it } from 'vitest';
import { makeEgosNamer, parseEgosNomes } from './nomes';

const cfg = {
  principal: 'Arquiteta',
  subagentes: { forja: 'Forja', 'general-purpose': 'Braço', Explore: 'Explorador', critico: 'Crítico' },
  personagens: { arquiteta: ['Hipátia', 'Ada Lovelace'], forja: ['Hefesto', 'Dédalo'], 'braço': ['Briareu', 'Atlas'] },
  salas: [
    { re: 'cliente-a|CLIENTE_A', nome: 'Cliente A', arquiteta: ['Têmis', 'Sólon'] },
    { re: '/egos(/|$)|orca/workspaces/egos(/|$)', nome: 'Kernel EGOS' },
  ],
};
const namer = makeEgosNamer(parseEgosNomes(JSON.stringify(cfg)))!;

describe('nomes da casa', () => {
  it('sem configuração ou JSON quebrado não muda nada', () => {
    expect(makeEgosNamer(parseEgosNomes(undefined))).toBeUndefined();
    expect(makeEgosNamer(parseEgosNomes('{quebrado'))).toBeUndefined();
  });
  it('principal: papel + personagem da sala, com a reserva em seguida', () => {
    expect(namer.main({ roomPath: '/home/user/egos' })).toEqual(['Arquiteta · Hipátia', 'Arquiteta · Ada Lovelace']);
    expect(namer.main({ roomPath: '/home/user/cliente-a/rj' })).toEqual(['Arquiteta · Têmis', 'Arquiteta · Sólon']);
  });
  it('Codex usa o nome da conta', () => {
    expect(namer.main({ provider: 'codex', accountName: 'Codex · conta1' })).toEqual(['Codex · conta1']);
  });
  it('subagente: papel da casa com acento + personagem; desconhecido vira capitalizado sem personagem', () => {
    expect(namer.sub({ role: 'forja' })).toEqual(['Forja · Hefesto', 'Forja · Dédalo']);
    expect(namer.sub({ role: 'critico' })).toEqual(['Crítico']);
    expect(namer.sub({ role: 'general-purpose' })).toEqual(['Braço · Briareu', 'Braço · Atlas']);
    expect(namer.sub({ role: 'explore' })).toEqual(['Explorador']);
    expect(namer.sub({ role: 'codex:codex-rescue' })).toEqual(['Codex-rescue']);
  });
  it('sala: nome da casa pelo caminho; o resto fica com o padrão', () => {
    expect(namer.room('/home/user/orca/workspaces/egos/UI-UX-Orca')).toBe('Kernel EGOS');
    expect(namer.room('/home/user/cliente-a')).toBe('Cliente A');
    expect(namer.room('/tmp/outra-coisa')).toBeUndefined();
  });
});

describe('nomes de sala e nomes livres', () => {
  it('repo e worktree com o mesmo nome da casa: o caminho mais curto leva o nome limpo', async () => {
    const { aplicarNomesDeSala } = await import('./nomes');
    const paths = new Map([['a', '/home/user/egos'], ['b', '/home/user/workspaces/egos/UI'], ['c', '/tmp/x']]);
    const names = new Map([['a', 'egos'], ['b', 'UI'], ['c', 'x']]);
    aplicarNomesDeSala(names, paths, namer);
    expect(names.get('a')).toBe('Kernel EGOS');
    expect(names.get('b')).toBe('Kernel EGOS · UI');
    expect(names.get('c')).toBe('x');
  });
  it('primeiroLivre: reserva, depois numeração', async () => {
    const { primeiroLivre } = await import('./nomes');
    expect(primeiroLivre(['A', 'B'], new Set(['A']))).toBe('B');
    expect(primeiroLivre(['A', 'B'], new Set(['A', 'B', 'A 2']))).toBe('A 3');
  });
});
