// Leitura das provas de um commit do kernel (funções puras; o git e o GitHub ficam em emitir.ts).
import { sha256, type Prova } from './recibo';

const TESTE_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)test_[^/]*$|(^|\/)tests?\/)/;
const IMAGEM_RE = /\.(png|jpe?g|webp|gif)$/i;
export const PROOFS_DIR = 'docs/_proofs/';

export interface ArquivoDoCommit {
  /** A, M, D, R... (git show --name-status). */
  status: string;
  path: string;
}

export interface PrInfo {
  numero: number;
  mesclado: boolean;
  /** Conclusões dos checks (SUCCESS, FAILURE, NEUTRAL, SKIPPED...). */
  checks: string[];
}

export interface EntradaProvas {
  mensagem: string;
  arquivos: ArquivoDoCommit[];
  /** sha256 do conteúdo de um arquivo no commit (para capturas). */
  digestDoArquivo: (path: string) => string | undefined;
  /** Linhas do docs/jobs/hitl-registry.jsonl. */
  hitl: string[];
  pr?: PrInfo;
}

/** Linhas "VERMELHO-ANTES: <caso> falhou sem o conserto (...)"; "n/a" não conta. */
export function vermelhoAntes(mensagem: string): string[] {
  return mensagem
    .split('\n')
    .map((l) => /^\s*VERMELHO-ANTES:\s*(.+)$/.exec(l)?.[1]?.trim() ?? '')
    .filter((t) => t && !/^n\/a\b/i.test(t));
}

/** PCAs citadas na mensagem, com a letra escolhida quando vem ("PCA-382:a" -> {pca: "PCA-382", letra: "a"}). */
export function pcasCitadas(mensagem: string): { pca: string; letra?: string }[] {
  const out = new Map<string, string | undefined>();
  for (const m of mensagem.matchAll(/\bPCA-(\d{1,5})(?::([a-z0-9]+))?/g)) {
    const pca = `PCA-${m[1]}`;
    if (!out.has(pca) || (!out.get(pca) && m[2])) out.set(pca, m[2]);
  }
  return [...out].map(([pca, letra]) => ({ pca, letra }));
}

/**
 * Linha do registro HITL que decide a PCA: cita a PCA e tem decisão gravada. Entre várias, vence a que tem a PCA na
 * pergunta e a decisão começando pela letra do commit; empate fica com a mais recente (a última do arquivo).
 */
export function decisaoHitl(linhas: readonly string[], pca: string, letra?: string): { linha: string; id?: string } | undefined {
  const re = new RegExp(`\\b${pca}\\b(?!\\d)`);
  let best: { linha: string; id?: string; score: number } | undefined;
  for (const linha of linhas) {
    if (!re.test(linha)) continue;
    try {
      const j = JSON.parse(linha) as { id?: string; decisao?: string; pergunta?: string; contexto_ref?: string };
      if (!j.decisao || !re.test(`${j.pergunta ?? ''} ${j.contexto_ref ?? ''} ${j.decisao}`)) continue;
      const score = (re.test(j.pergunta ?? '') ? 2 : 0) + (letra && j.decisao.trim().toLowerCase().startsWith(letra.toLowerCase()) ? 2 : 0);
      if (!best || score >= best.score) best = { linha, id: j.id, score };
    } catch {
      // linha quebrada no registro: ignora
    }
  }
  return best ? { linha: best.linha, id: best.id } : undefined;
}

export function provasDoCommit(e: EntradaProvas): Prova[] {
  const provas: Prova[] = [];
  const testes = e.arquivos.filter((a) => a.status !== 'D' && TESTE_RE.test(a.path));
  for (const caso of vermelhoAntes(e.mensagem)) {
    // Declaração sem arquivo de teste no commit não prova nada.
    if (!testes.length) break;
    provas.push({ tipo: 'teste-vermelho-verde', nivel: 'declarado', digest: sha256(caso), ref: caso.slice(0, 160) });
  }
  for (const a of e.arquivos) {
    if (!/^[AM]/.test(a.status) || !a.path.startsWith(PROOFS_DIR) || !IMAGEM_RE.test(a.path)) continue;
    const d = e.digestDoArquivo(a.path);
    if (d) provas.push({ tipo: 'prova-visual', nivel: 'registrado', digest: d, ref: a.path });
  }
  for (const { pca, letra } of pcasCitadas(e.mensagem)) {
    const h = decisaoHitl(e.hitl, pca, letra);
    if (h) provas.push({ tipo: 'decisao-hitl', nivel: 'registrado', digest: sha256(h.linha), ref: h.id ? `${pca} (registro ${h.id})` : pca });
  }
  if (e.pr?.mesclado && e.pr.checks.length && e.pr.checks.every((c) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c))) {
    provas.push({ tipo: 'pr-ci-verde', nivel: 'verificado', digest: sha256(`#${e.pr.numero}:${e.pr.checks.join(',')}`), ref: `#${e.pr.numero}` });
  }
  return provas;
}

/** "(#780)" no fim do título. */
export function prDoTitulo(titulo: string): number | undefined {
  const m = /\(#(\d+)\)\s*$/.exec(titulo);
  return m ? Number(m[1]) : undefined;
}
