import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assinar, pubBase64, RECIBO_TIPO, RECIBO_VERSAO } from '../recibo/recibo';
import { lerRecibos, montarResposta, PlacarConfig } from './recibos';

function recibo(priv: string, conta: string, projeto: string, commit: string) {
  return assinar(
    {
      tipo: RECIBO_TIPO,
      v: RECIBO_VERSAO,
      esquema: 't',
      quem: { conta, sessao: `s-${conta}`, origem: 'manual' },
      oque: { repo: 'r', projeto, commit, titulo: 't', mesclado: true },
      provas: [{ tipo: 'decisao-hitl', nivel: 'registrado', digest: 'sha256:1' }],
      pontos: 25,
      estado: 'ACEITO',
      quando: commit,
      emitidoEm: 'x',
    },
    priv,
  );
}

describe('recibos no servidor', () => {
  const k = generateKeyPairSync('ed25519');
  const priv = k.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
  const dir = mkdtempSync(join(tmpdir(), 'egos-recibos-'));
  writeFileSync(join(dir, 'a.json'), JSON.stringify(recibo(priv, '.claude', 'Kernel', '2026-10-01')));
  writeFileSync(join(dir, 'b.json'), JSON.stringify(recibo(priv, '.codex', 'Kernel', '2026-10-02')));
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ ...recibo(priv, '.claude', 'Outro', '2026-10-03'), pontos: 900 }));
  writeFileSync(join(dir, 'lixo.json'), '{quebrado');

  it('verifica cada recibo; adulterado vale zero e aparece como inválido', () => {
    const list = lerRecibos(dir, [pubBase64(k.publicKey)]);
    expect(list).toHaveLength(3);
    expect(list.filter((r) => r.valido)).toHaveLength(2);
    expect(list.find((r) => !r.valido)).toMatchObject({ estado: 'INVÁLIDO', pontos: 0 });
  });
  it('placar: conta só aparece com opt-in; clãs somam por projeto', () => {
    const list = lerRecibos(dir, []);
    const sem = montarResposta(list, {}, (id) => id, true, 0);
    expect(sem.contas).toEqual([]);
    expect(sem.clas).toEqual([{ id: 'Kernel', nome: 'Kernel', pontos: 50, recibos: 2 }]);
    const com = montarResposta(list, { '.claude': true }, (id) => `Conta ${id}`, true, 0);
    expect(com.contas).toEqual([{ id: '.claude', nome: 'Conta .claude', pontos: 25, recibos: 1 }]);
  });
  it('opt-in gravado no dataDir, desligado por padrão', () => {
    const p = new PlacarConfig(join(dir, 'placar.json'));
    expect(p.get()).toEqual({});
    p.set('.claude', true);
    expect(new PlacarConfig(join(dir, 'placar.json')).get()).toEqual({ '.claude': true });
    p.set('.claude', false);
    expect(new PlacarConfig(join(dir, 'placar.json')).get()).toEqual({});
  });
  it('sem pasta configurada: lista vazia', () => {
    expect(lerRecibos(undefined, [])).toEqual([]);
  });
});
