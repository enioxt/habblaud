import { afterEach, describe, expect, it } from 'vitest';
import { economia, Wallets } from '../../client/src/world/social/wallet';

const agente = { id: 'a1', name: 'Arquiteta', kind: 'main' as const, tasks: [{ id: 't', title: 'x', status: 'completed' }] };

describe('economia por recibo', () => {
  afterEach(() => {
    economia.porRecibo = false;
  });
  it('ninguém ganha por chegar nem por tarefa marcada; só recibo paga, uma vez', () => {
    economia.porRecibo = true;
    const w = new Wallets(null);
    w.ensure(agente, 0);
    expect(w.coins('a1')).toBe(0);
    expect(w.creditOnce('a1', 'recibo:h1', 35, '🧾', 'Recibo', 1)).toBe(35);
    expect(w.creditOnce('a1', 'recibo:h1', 35, '🧾', 'Recibo', 2)).toBe(0);
    expect(w.coins('a1')).toBe(35);
  });
  it('sem a camada, o Habblaud original continua igual (saldo inicial)', () => {
    const w = new Wallets(null);
    w.ensure(agente, 0);
    expect(w.coins('a1')).toBeGreaterThan(0);
  });
});
