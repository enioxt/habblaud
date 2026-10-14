// Classes pela evidência (RPG da casa, sem teatro): a classe sai da proporção dos sinais no histórico de commits,
// a subclasse da linguagem dominante; a tela sempre mostra o porquê com os números.
// Base: docs/concepts/GAMIFICACAO_SSOT.md (classe = contrato operacional; cooperação > competição; clã por propósito)
// e as funções do circuito da casa (Investigador, Provador, Contestador, Sintetizador, Ponte, Guardião) + Arquiteto e
// Cronista. Puro (roda no servidor, no host e nos testes).
import { canonico, idDaChave, pubDeBase64, sha256 } from './recibo';
import { verify } from 'node:crypto';

/** Sinal de classe -> classe e o que conta. */
export const SINAIS = {
  teste: { classe: 'Provador', conta: 'commits que mexem em teste (×4 quando o teste foi visto vermelho antes)' },
  arquitetura: { classe: 'Arquiteto', conta: 'commits em governança/arquitetura + 2 por decisão sua registrada' },
  docs: { classe: 'Cronista', conta: 'commits só de documentação' },
  seguranca: { classe: 'Guardião', conta: 'commits de segurança, PII, LGPD, segredos' },
  investigacao: { classe: 'Investigador', conta: 'commits de pesquisa, investigação, radar' },
  ponte: { classe: 'Ponte', conta: 'commits de integração (conector, MCP, API, federação, sync)' },
  contestacao: { classe: 'Contestador', conta: 'reverts, revisões e refutações' },
  sintese: { classe: 'Sintetizador', conta: 'consolidações, mapas, relatórios, índices, handoffs' },
} as const;
export type Sinal = keyof typeof SINAIS;
export type Sinais = Record<Sinal, number>;

export interface ContagensHistorico {
  commits: number;
  prsMesclados: number;
  testeVermelhoVerde: number;
  provasVisuais: number;
  decisoesHitl: number;
}

/** Commit simples vale pouco; PR mesclado mais; teste vermelho→verde, captura e decisão humana valem o mesmo que no recibo novo. */
export const PESOS_HISTORICO: Readonly<Record<keyof ContagensHistorico, number>> = {
  commits: 1,
  prsMesclados: 5,
  testeVermelhoVerde: 30,
  provasVisuais: 20,
  decisoesHitl: 25,
};

export function pontosHistorico(c: ContagensHistorico): number {
  return (Object.keys(PESOS_HISTORICO) as (keyof ContagensHistorico)[]).reduce((s, k) => s + Math.max(0, Math.floor(c[k] ?? 0)) * PESOS_HISTORICO[k], 0);
}

export interface ReciboHistorico {
  tipo: 'egos.recibo.historico';
  v: 1;
  quem: { pessoa: string; contas: string[]; origem: 'historico' };
  repo: { nome: string; projeto: string; privado: boolean; linguagem?: string; linguagens?: Record<string, number>; clone: boolean };
  contagens: ContagensHistorico;
  sinais: Sinais;
  pesos: Readonly<Record<keyof ContagensHistorico, number>>;
  pontos: number;
  digest: string;
  quando: string;
  chave: { alg: 'Ed25519'; id: string; pub: string };
  hash: string;
  assinatura: string;
}

export function verificarHistorico(dado: unknown, confiaveis: readonly string[] = []): { ok: true; recibo: ReciboHistorico } | { ok: false; motivo: string } {
  const r = dado as Partial<ReciboHistorico> | null;
  if (!r || r.tipo !== 'egos.recibo.historico' || r.v !== 1 || !r.chave?.pub || !r.hash || !r.assinatura || !r.contagens) return { ok: false, motivo: 'não é recibo histórico v1' };
  const { hash, assinatura, ...corpo } = r as ReciboHistorico;
  const bytes = Buffer.from(canonico(corpo));
  if (sha256(bytes) !== hash) return { ok: false, motivo: 'resumo não confere' };
  if (idDaChave(r.chave.pub) !== r.chave.id) return { ok: false, motivo: 'id da chave não confere' };
  let ok = false;
  try {
    ok = verify(null, bytes, pubDeBase64(r.chave.pub), Buffer.from(assinatura, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, motivo: 'assinatura inválida' };
  if (confiaveis.length && !confiaveis.includes(r.chave.pub)) return { ok: false, motivo: 'chave fora da lista de confiança' };
  if (canonico(r.pesos) !== canonico(PESOS_HISTORICO) || pontosHistorico(r.contagens) !== r.pontos) return { ok: false, motivo: 'pontos não batem com as contagens' };
  return { ok: true, recibo: r as ReciboHistorico };
}

export interface Perfil {
  pessoa: string;
  contas: string[];
  saldo: number;
  classe: string;
  subclasse: string;
  /** Linhas "por que você é desta classe", com os números. */
  porque: string[];
  /** Distribuição das classes (%), da maior para a menor. */
  distribuicao: { classe: string; pct: number; sinais: number }[];
  totais: ContagensHistorico & { repos: number; privados: number };
  clas: { nome: string; pontos: number }[];
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

/** Perfil de uma pessoa a partir dos recibos históricos verificados dela. */
export function classificar(recibos: readonly ReciboHistorico[]): Perfil | undefined {
  if (!recibos.length) return undefined;
  const pessoa = recibos[0].quem.pessoa;
  const contas = [...new Set(recibos.flatMap((r) => r.quem.contas))];
  const sinais = Object.fromEntries(Object.keys(SINAIS).map((k) => [k, 0])) as Sinais;
  const totais = { commits: 0, prsMesclados: 0, testeVermelhoVerde: 0, provasVisuais: 0, decisoesHitl: 0, repos: recibos.length, privados: 0 };
  const langs: Record<string, number> = {};
  const clas = new Map<string, number>();
  let saldo = 0;
  for (const r of recibos) {
    for (const k of Object.keys(SINAIS) as Sinal[]) sinais[k] += r.sinais[k] ?? 0;
    for (const k of Object.keys(PESOS_HISTORICO) as (keyof ContagensHistorico)[]) totais[k] += r.contagens[k] ?? 0;
    if (r.repo.privado) totais.privados++;
    saldo += r.pontos;
    clas.set(r.repo.projeto, (clas.get(r.repo.projeto) ?? 0) + r.pontos);
    if (r.repo.linguagens) {
      for (const [l, n] of Object.entries(r.repo.linguagens)) if (l !== 'Markdown' && l !== 'JSON' && l !== 'YAML') langs[l] = (langs[l] ?? 0) + n;
    } else if (r.repo.linguagem) langs[r.repo.linguagem] = (langs[r.repo.linguagem] ?? 0) + r.contagens.commits;
  }
  const soma = Object.values(sinais).reduce((a, b) => a + b, 0);
  const porClasse = new Map<string, number>();
  for (const k of Object.keys(SINAIS) as Sinal[]) porClasse.set(SINAIS[k].classe, (porClasse.get(SINAIS[k].classe) ?? 0) + sinais[k]);
  const distribuicao = [...porClasse]
    .map(([classe, n]) => ({ classe, sinais: n, pct: soma ? Math.round((n / soma) * 100) : 0 }))
    .sort((a, b) => b.sinais - a.sinais);
  const top = distribuicao[0];
  const classe = soma ? top.classe : 'Aprendiz';
  const lang = Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0];
  const segunda = distribuicao[1];
  const subclasse = [lang, segunda && segunda.sinais ? `toque de ${segunda.classe}` : undefined].filter(Boolean).join(' · ') || '—';
  const sinalTop = (Object.keys(SINAIS) as Sinal[]).filter((k) => SINAIS[k].classe === classe);
  const porque = soma
    ? [
        `${classe}: ${top.pct}% dos sinais (${fmt(top.sinais)} de ${fmt(soma)}) — ${sinalTop.map((k) => SINAIS[k].conta).join('; ')}`,
        ...distribuicao.slice(1, 3).filter((d) => d.sinais).map((d) => `${d.classe}: ${d.pct}% (${fmt(d.sinais)})`),
        lang ? `Subclasse ${lang}: linguagem mais tocada nos commits (${fmt(langs[lang])} arquivos)` : 'Sem clone local: linguagem vem do GitHub',
        `Saldo inicial ${fmt(saldo)} pts = ${fmt(totais.commits)} commits ×1 + ${fmt(totais.prsMesclados)} PRs mesclados ×5 + ${fmt(totais.testeVermelhoVerde)} testes vermelho→verde ×30 + ${fmt(totais.provasVisuais)} capturas ×20 + ${fmt(totais.decisoesHitl)} decisões suas ×25`,
      ]
    : ['Sem sinais suficientes no histórico (nenhum clone local com commits da pessoa).'];
  return {
    pessoa,
    contas,
    saldo,
    classe,
    subclasse,
    porque,
    distribuicao,
    totais,
    clas: [...clas].map(([nome, pontos]) => ({ nome, pontos })).sort((a, b) => b.pontos - a.pontos),
  };
}
