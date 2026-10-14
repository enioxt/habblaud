import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonico, idDaChave, pubBase64, sha256 } from './recibo';
import { classificar, PESOS_HISTORICO, pontosHistorico, verificarHistorico, type ReciboHistorico, type Sinais } from './classes';

const zero: Sinais = { teste: 0, arquitetura: 0, docs: 0, seguranca: 0, investigacao: 0, ponte: 0, contestacao: 0, sintese: 0 };

function hist(nome: string, sinais: Partial<Sinais>, contagens = { commits: 10, prsMesclados: 2, testeVermelhoVerde: 1, provasVisuais: 0, decisoesHitl: 1 }): ReciboHistorico {
  const k = generateKeyPairSync('ed25519');
  const pem = k.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
  const pub = pubBase64(createPublicKey(createPrivateKey(pem)));
  const corpo = {
    tipo: 'egos.recibo.historico' as const,
    v: 1 as const,
    quem: { pessoa: 'p', contas: ['.claude'], origem: 'historico' as const },
    repo: { nome, projeto: nome, privado: false, linguagens: { TypeScript: 5 }, clone: true },
    contagens,
    sinais: { ...zero, ...sinais },
    pesos: PESOS_HISTORICO,
    pontos: pontosHistorico(contagens),
    digest: 'sha256:0',
    quando: 'x',
    chave: { alg: 'Ed25519' as const, id: idDaChave(pub), pub },
  };
  const bytes = Buffer.from(canonico(corpo));
  return { ...corpo, hash: sha256(bytes), assinatura: sign(null, bytes, createPrivateKey(pem)).toString('base64') };
}

describe('recibo histórico e classe pela evidência', () => {
  it('pontos: commit 1, PR 5, teste vermelho→verde 30, decisão 25', () => {
    expect(pontosHistorico({ commits: 10, prsMesclados: 2, testeVermelhoVerde: 1, provasVisuais: 0, decisoesHitl: 1 })).toBe(10 + 10 + 30 + 25);
  });
  it('verifica a assinatura e recusa pontos inflados', () => {
    const r = hist('a', { teste: 3 });
    expect(verificarHistorico(r).ok).toBe(true);
    expect(verificarHistorico({ ...r, pontos: 9999 }).ok).toBe(false);
  });
  it('classe = maior proporção de sinais; o porquê traz os números', () => {
    const p = classificar([hist('a', { teste: 30, docs: 5 }), hist('b', { arquitetura: 10 })])!;
    expect(p.classe).toBe('Provador');
    expect(p.subclasse).toContain('TypeScript');
    expect(p.porque[0]).toMatch(/^Provador: 67% dos sinais \(30 de 45\)/);
    expect(p.saldo).toBe(2 * 75);
    expect(p.clas.map((c) => c.nome).sort()).toEqual(['a', 'b']);
  });
});
