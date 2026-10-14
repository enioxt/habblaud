import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinar, canonico, estadoDe, pontosDe, pubBase64, RECIBO_TIPO, RECIBO_VERSAO, verificarRecibo, type CorpoRecibo, type Prova } from './recibo';
import { decisaoHitl, pcasCitadas, prDoTitulo, provasDoCommit, vermelhoAntes } from './provas';

const par = () => generateKeyPairSync('ed25519');
const pem = (k: ReturnType<typeof par>) => k.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;

function corpo(provas: Prova[]): Omit<CorpoRecibo, 'chave'> {
  return {
    tipo: RECIBO_TIPO,
    v: RECIBO_VERSAO,
    esquema: 'teste',
    quem: { conta: '.claude', sessao: 's1', agente: 'Arquiteta', origem: 'manual' },
    oque: { repo: 'egos', projeto: 'Kernel EGOS', commit: 'a'.repeat(40), titulo: 'fix: x (#1)', pr: 1, mesclado: true },
    provas,
    pontos: pontosDe(provas),
    estado: estadoDe(provas),
    quando: '2026-10-13T17:48:29-03:00',
    emitidoEm: '2026-10-14T06:00:00.000Z',
  };
}

const hitl: Prova = { tipo: 'decisao-hitl', nivel: 'registrado', digest: 'sha256:00', ref: 'PCA-1' };

describe('recibo: assinatura e verificação offline', () => {
  it('JSON canônico ordena chaves e ignora undefined', () => {
    expect(canonico({ b: 1, a: [true, null, 'x'], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
  });
  it('recibo assinado verifica; com a chave na lista de confiança também', () => {
    const k = par();
    const r = assinar(corpo([hitl]), pem(k));
    expect(verificarRecibo(r).ok).toBe(true);
    expect(verificarRecibo(r, [pubBase64(k.publicKey)]).ok).toBe(true);
  });
  it('qualquer alteração derruba: pontos, quem, provas, assinatura', () => {
    const r = assinar(corpo([hitl]), pem(par()));
    expect(verificarRecibo({ ...r, pontos: 999 })).toMatchObject({ ok: false });
    expect(verificarRecibo({ ...r, quem: { ...r.quem, conta: '.outra' } })).toMatchObject({ ok: false, motivo: expect.stringContaining('resumo') });
    expect(verificarRecibo({ ...r, assinatura: Buffer.alloc(64).toString('base64') })).toMatchObject({ ok: false, motivo: 'assinatura inválida' });
  });
  it('recibo honesto de outra chave cai fora da lista de confiança', () => {
    const r = assinar(corpo([hitl]), pem(par()));
    expect(verificarRecibo(r, [pubBase64(par().publicKey)])).toMatchObject({ ok: false, motivo: 'chave fora da lista de confiança' });
  });
  it('re-assinar com pontos inflados não passa: pontos e estado são recalculados das provas', () => {
    const k = par();
    const c = { ...corpo([hitl]), pontos: 500 };
    expect(verificarRecibo(assinar(c, pem(k)))).toMatchObject({ ok: false, motivo: 'pontos não batem com as provas' });
  });
  it('pontos por tipo, uma vez por tipo; nada de prova = recusado', () => {
    const vis = (d: string): Prova => ({ tipo: 'prova-visual', nivel: 'registrado', digest: d });
    expect(pontosDe([vis('1'), vis('2'), hitl])).toBe(20 + 25);
    expect(estadoDe([vis('1')])).toBe('VERIFICADO');
    expect(estadoDe([{ tipo: 'teste-vermelho-verde', nivel: 'declarado', digest: 'x' }])).toBe('DECLARADO');
    expect(verificarRecibo(assinar(corpo([]), pem(par())))).toMatchObject({ ok: false, motivo: 'recibo sem prova' });
  });
});

describe('provas de um commit', () => {
  const linhas = [
    JSON.stringify({ id: 'velho', pergunta: 'Segundo corte de três regras', contexto_ref: 'PCA-382 lista', decisao: 'b — outra coisa' }),
    JSON.stringify({ id: 'certo', pergunta: 'PCA-382: gravar como lei', decisao: 'a — grava' }),
    JSON.stringify({ id: 'sem-decisao', pergunta: 'PCA-383: x' }),
    JSON.stringify({ id: 'parecido', pergunta: 'PCA-3820: y', decisao: 'a' }),
  ];
  it('VERMELHO-ANTES: n/a não conta', () => {
    expect(vermelhoAntes('x\nVERMELHO-ANTES: caso A falhou sem o conserto (3/4)\n')).toEqual(['caso A falhou sem o conserto (3/4)']);
    expect(vermelhoAntes('VERMELHO-ANTES: n/a — só docs')).toEqual([]);
  });
  it('PCA com letra escolhe a decisão certa; PCA sem decisão ou número parecido não casa', () => {
    expect(pcasCitadas('lei(PCA-382:a) e PCA-383')).toEqual([{ pca: 'PCA-382', letra: 'a' }, { pca: 'PCA-383', letra: undefined }]);
    expect(decisaoHitl(linhas, 'PCA-382', 'a')?.id).toBe('certo');
    expect(decisaoHitl(linhas, 'PCA-383')).toBeUndefined();
    expect(decisaoHitl(linhas.slice(0, 1).concat(linhas[3]), 'PCA-382', 'a')?.id).toBe('velho');
  });
  it('teste declarado sem arquivo de teste no commit não vira prova (teste negativo)', () => {
    const base = { mensagem: 'fix: y\n\nVERMELHO-ANTES: caso falhou sem o conserto (0/1)', hitl: [], digestDoArquivo: () => 'sha256:ff' };
    expect(provasDoCommit({ ...base, arquivos: [{ status: 'M', path: 'src/a.ts' }] })).toEqual([]);
    expect(provasDoCommit({ ...base, arquivos: [{ status: 'M', path: 'src/a.test.ts' }] }).map((p) => p.tipo)).toEqual(['teste-vermelho-verde']);
  });
  it('captura nova em docs/_proofs vira prova visual; PR só conta mesclado e com todos os checks verdes', () => {
    const e = { mensagem: 'feat: z (#9)', hitl: [], digestDoArquivo: () => 'sha256:ab', arquivos: [{ status: 'A', path: 'docs/_proofs/2026-10-14-x.png' }, { status: 'A', path: 'docs/outro.png' }] };
    expect(provasDoCommit(e).map((p) => p.tipo)).toEqual(['prova-visual']);
    expect(provasDoCommit({ ...e, arquivos: [], pr: { numero: 9, mesclado: true, checks: ['SUCCESS', 'SKIPPED'] } }).map((p) => p.tipo)).toEqual(['pr-ci-verde']);
    expect(provasDoCommit({ ...e, arquivos: [], pr: { numero: 9, mesclado: true, checks: ['SUCCESS', 'FAILURE'] } })).toEqual([]);
    expect(provasDoCommit({ ...e, arquivos: [], pr: { numero: 9, mesclado: false, checks: ['SUCCESS'] } })).toEqual([]);
    expect(prDoTitulo('feat: z (#9)')).toBe(9);
  });
  it('commit sem nada disso: nenhuma prova (sem prova, sem recibo)', () => {
    expect(provasDoCommit({ mensagem: 'noop', arquivos: [{ status: 'A', path: 'x' }], hitl: linhas, digestDoArquivo: () => undefined })).toEqual([]);
  });
});
