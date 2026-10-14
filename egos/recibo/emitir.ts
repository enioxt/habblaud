#!/usr/bin/env bun
// Emite o recibo de uma entrega provada do kernel (roda no host; a chave nunca vai para o container nem para o git).
//
//   bun egos/recibo/emitir.ts --commit <sha> [--repo ~/egos] [--sem-rede] [--conta .claude --sessao <id>] [--refazer]
//   bun egos/recibo/emitir.ts --entregas [--repo ~/egos]     (commits citados nas Entregas do Habblaud em :4747)
//
// Lê o commit (mensagem, arquivos), confere VERMELHO-ANTES: + arquivo de teste, capturas novas em docs/_proofs/,
// decisões no docs/jobs/hitl-registry.jsonl e, com rede, o PR mesclado com CI verde. Sem prova, sem recibo (sai 2).
// Quem: a sessão do Claude Code/Codex cujo transcript mostra o commit sendo criado (ou --conta/--sessao).
// Saída: ~/.egos/recibos/<commit12>.json. Chave: ~/.habblaud/chave-recibo (0600), criada na primeira vez.
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { assinar, estadoDe, pontosDe, RECIBO_TIPO, RECIBO_VERSAO, sha256, type CorpoRecibo, type Recibo } from './recibo';
import { prDoTitulo, provasDoCommit, type ArquivoDoCommit, type PrInfo } from './provas';

const HOME = homedir();
export const CHAVE = process.env.EGOS_RECIBO_CHAVE ?? join(HOME, '.habblaud', 'chave-recibo');
export const DIR_RECIBOS = process.env.EGOS_RECIBOS_DIR ?? join(HOME, '.egos', 'recibos');
const NOMES = join(HOME, '.habblaud', 'nomes-egos.json');

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

/** Lê a chave privada; cria o par na primeira vez (privada 0600, pública ao lado). */
export function chavePrivada(path = CHAVE): string {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }) as string, { mode: 0o600 });
    writeFileSync(`${path}.pub`, publicKey.export({ format: 'pem', type: 'spki' }) as string, { mode: 0o644 });
    console.error(`[recibo] chave nova criada em ${path} (0600) e ${path}.pub`);
  }
  chmodSync(path, 0o600);
  return readFileSync(path, 'utf8');
}

function lerNomes(): { principal?: string; salas?: { re: string; nome: string }[]; contas?: Record<string, { name?: string }> } {
  try {
    return JSON.parse(readFileSync(NOMES, 'utf8'));
  } catch {
    return {};
  }
}

function projetoDe(repoPath: string): string {
  for (const s of lerNomes().salas ?? []) {
    try {
      if (new RegExp(s.re, 'i').test(repoPath)) return s.nome;
    } catch {
      // regex ruim no arquivo da casa: ignora
    }
  }
  return basename(repoPath);
}

function prInfo(repo: string, numero: number): (PrInfo & { commits: string[] }) | undefined {
  try {
    const raw = execFileSync('gh', ['pr', 'view', String(numero), '--json', 'mergedAt,statusCheckRollup,commits'], { cwd: repo, encoding: 'utf8', timeout: 20_000 });
    const j = JSON.parse(raw) as { mergedAt?: string | null; statusCheckRollup?: { conclusion?: string; state?: string }[]; commits?: { oid: string }[] };
    return {
      numero,
      mesclado: !!j.mergedAt,
      checks: (j.statusCheckRollup ?? []).map((c) => (c.conclusion || c.state || 'PENDING').toUpperCase()),
      commits: (j.commits ?? []).map((c) => c.oid),
    };
  } catch {
    return undefined;
  }
}

/** Pastas de conta (Claude: projects; Codex: sessions), inclusive o espelho da VPS. */
function raizesDeConta(): { conta: string; dir: string; provider: 'claude' | 'codex' }[] {
  const out: { conta: string; dir: string; provider: 'claude' | 'codex' }[] = [];
  const bases = [HOME, join(HOME, '.habblaud', 'vps')];
  for (const base of bases) {
    let nomes: string[] = [];
    try {
      nomes = readdirSync(base);
    } catch {
      continue;
    }
    for (const n of nomes) {
      if (/^\.(vps-)?claude/.test(n) && existsSync(join(base, n, 'projects'))) out.push({ conta: n, dir: join(base, n, 'projects'), provider: 'claude' });
      if (/^\.(vps-)?codex/.test(n) && existsSync(join(base, n, 'sessions'))) out.push({ conta: n, dir: join(base, n, 'sessions'), provider: 'codex' });
    }
  }
  return out;
}

/**
 * Procura o transcript em que o commit foi CRIADO: saída do `git commit` ("[ramo abc1234]") ou do `git log --oneline`
 * logo depois ("abc1234 <título>"). Só citar o sha numa conversa não basta. Transcript principal vence o de subagente.
 */
export function acharSessao(shas: string[], titulo: string): CorpoRecibo['quem'] | undefined {
  const t = titulo.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '\\\\"');
  const pat = shas.map((sha) => `(\\[[^]\\\\]{1,200} ${sha.slice(0, 7)}[0-9a-f]{0,33}\\])|(${sha.slice(0, 7)}[0-9a-f]{0,33} ${t})`).join('|');
  const achados: { f: string; r: ReturnType<typeof raizesDeConta>[number] }[] = [];
  for (const r of raizesDeConta()) {
    try {
      for (const f of execFileSync('grep', ['-rlE', '--include=*.jsonl', pat, r.dir], { encoding: 'utf8', timeout: 60_000 }).split('\n').filter(Boolean)) achados.push({ f, r });
    } catch {
      // nada nesta conta
    }
  }
  if (!achados.length) return undefined;
  // Transcript principal antes do de subagente; entre iguais, o mais antigo (quem criou vem antes de quem citou).
  achados.sort((a, b) => Number(a.f.includes('/subagents/')) - Number(b.f.includes('/subagents/')) || statSync(a.f).mtimeMs - statSync(b.f).mtimeMs);
  const { f, r } = achados[0];
  const sub = f.includes('/subagents/');
  const sessao = sub ? basename(dirname(dirname(f))) : r.provider === 'codex' ? (/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/.exec(f)?.[1] ?? basename(f, '.jsonl')) : basename(f, '.jsonl');
  const nomes = lerNomes();
  const agente = r.provider === 'codex' ? (nomes.contas?.[r.conta]?.name ?? 'Codex') : (nomes.principal ?? 'Claude');
  return { conta: r.conta, sessao, agente: sub ? `${agente} (subagente)` : agente, origem: 'transcript' };
}

export interface OpcoesEmitir {
  commit: string;
  repo: string;
  semRede?: boolean;
  conta?: string;
  sessao?: string;
  agente?: string;
  refazer?: boolean;
  dir?: string;
  chave?: string;
  origem?: CorpoRecibo['quem']['origem'];
}

export type ResultadoEmitir = { ok: true; recibo: Recibo; arquivo: string; novo: boolean } | { ok: false; motivo: string };

export function emitir(o: OpcoesEmitir): ResultadoEmitir {
  let sha: string;
  try {
    sha = git(o.repo, 'rev-parse', '--verify', `${o.commit}^{commit}`).trim();
  } catch {
    return { ok: false, motivo: `commit ${o.commit} não existe em ${o.repo}` };
  }
  const dir = o.dir ?? DIR_RECIBOS;
  const arquivo = join(dir, `${sha.slice(0, 12)}.json`);
  if (existsSync(arquivo) && !o.refazer) {
    return { ok: true, recibo: JSON.parse(readFileSync(arquivo, 'utf8')) as Recibo, arquivo, novo: false };
  }
  const [titulo, ...resto] = git(o.repo, 'log', '-1', '--format=%s%n%cI%n%B', sha).split('\n');
  const quando = resto[0];
  const mensagem = resto.slice(1).join('\n');
  const arquivos: ArquivoDoCommit[] = git(o.repo, 'show', '--name-status', '--format=', '--no-renames', sha)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [status, path] = l.split('\t');
      return { status, path };
    });
  let hitl: string[] = [];
  try {
    hitl = git(o.repo, 'show', `${sha}:docs/jobs/hitl-registry.jsonl`).split('\n').filter(Boolean);
  } catch {
    hitl = [];
  }
  // A decisão pode ter sido registrada depois do commit: vale também o registro atual da main.
  try {
    hitl.push(...readFileSync(join(o.repo, 'docs/jobs/hitl-registry.jsonl'), 'utf8').split('\n').filter(Boolean));
  } catch {
    // sem registro na árvore de trabalho
  }
  const numero = prDoTitulo(titulo);
  const pr = numero && !o.semRede ? prInfo(o.repo, numero) : undefined;
  const provas = provasDoCommit({
    mensagem,
    arquivos,
    hitl,
    pr,
    digestDoArquivo: (path) => {
      try {
        return sha256(execFileSync('git', ['-C', o.repo, 'cat-file', 'blob', `${sha}:${path}`], { maxBuffer: 64 << 20 }));
      } catch {
        return undefined;
      }
    },
  });
  if (!provas.length) return { ok: false, motivo: `sem prova, sem recibo: ${sha.slice(0, 9)} não tem VERMELHO-ANTES: com teste, captura em docs/_proofs/, decisão HITL citada nem PR com CI verde` };

  let mesclado = false;
  for (const ref of ['origin/main', 'main']) {
    try {
      git(o.repo, 'merge-base', '--is-ancestor', sha, ref);
      mesclado = true;
      break;
    } catch {
      // não é ancestral (ou ref ausente)
    }
  }
  const quem: CorpoRecibo['quem'] =
    o.conta || o.sessao
      ? { conta: o.conta, sessao: o.sessao, agente: o.agente, origem: o.origem ?? 'manual' }
      : (acharSessao([sha, ...(pr?.commits ?? [])], titulo) ?? { origem: 'desconhecida' });
  const corpo: Omit<CorpoRecibo, 'chave'> = {
    tipo: RECIBO_TIPO,
    v: RECIBO_VERSAO,
    esquema: 'ActionReceipt simplificado, no espírito do OpenWorkProof (Apache-2.0)',
    quem,
    oque: { repo: basename(git(o.repo, 'rev-parse', '--show-toplevel').trim()), projeto: projetoDe(o.repo), commit: sha, titulo: titulo.slice(0, 200), pr: numero, mesclado },
    provas,
    pontos: pontosDe(provas),
    estado: estadoDe(provas),
    quando,
    emitidoEm: new Date().toISOString(),
  };
  const recibo = assinar(corpo, o.chave ?? chavePrivada());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(arquivo, `${JSON.stringify(recibo, null, 2)}\n`, { mode: 0o644 });
  return { ok: true, recibo, arquivo, novo: true };
}

/** Commits do kernel citados nas Entregas que o Habblaud já montou (quem = a conta e a sessão da entrega). */
async function daEntregas(repo: string, base: string): Promise<OpcoesEmitir[]> {
  const res = await fetch(`${base}/api/deliveries`);
  if (!res.ok) throw new Error(`Habblaud respondeu ${res.status} em /api/deliveries`);
  const { deliveries } = (await res.json()) as { deliveries: { account: string; sessionId: string; agentName?: string; text: string }[] };
  const out = new Map<string, OpcoesEmitir>();
  for (const d of deliveries) {
    for (const m of d.text.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
      try {
        const sha = git(repo, 'rev-parse', '--verify', '--quiet', `${m[0]}^{commit}`).trim();
        if (sha && !out.has(sha)) out.set(sha, { commit: sha, repo, conta: d.account, sessao: d.sessionId, agente: d.agentName?.split(' · ')[0], origem: 'entrega' });
      } catch {
        // não é commit deste repo
      }
    }
  }
  return [...out.values()];
}

async function main(argv: string[]): Promise<number> {
  const arg = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = (arg('--repo') ?? process.env.EGOS_KERNEL ?? join(HOME, 'egos')).replace(/^~(?=\/|$)/, HOME);
  const base = { repo, semRede: argv.includes('--sem-rede'), refazer: argv.includes('--refazer') };
  let lista: OpcoesEmitir[];
  if (argv.includes('--entregas')) lista = (await daEntregas(repo, arg('--habblaud') ?? 'http://127.0.0.1:4747')).map((o) => ({ ...o, ...base }));
  else {
    const commit = arg('--commit');
    if (!commit) {
      console.error('uso: bun egos/recibo/emitir.ts --commit <sha> [--repo ~/egos] [--sem-rede] [--conta X --sessao Y] [--refazer] | --entregas');
      return 64;
    }
    lista = [{ ...base, commit, conta: arg('--conta'), sessao: arg('--sessao'), agente: arg('--agente') }];
  }
  let falhas = 0;
  for (const o of lista) {
    const r = emitir(o);
    if (!r.ok) {
      falhas++;
      console.error(`[recibo] ${r.motivo}`);
      continue;
    }
    const q = r.recibo.quem;
    console.log(
      `${r.novo ? 'emitido' : 'já existia'} ${r.recibo.hash} · ${r.recibo.oque.commit.slice(0, 9)} · ${r.recibo.estado} · ${r.recibo.pontos} pts · ` +
        `${r.recibo.provas.map((p) => `${p.tipo}(${p.nivel})`).join(' + ')} · quem: ${q.agente ?? '?'} ${q.conta ?? ''} ${q.sessao?.slice(0, 8) ?? ''} (${q.origem}) · ${r.arquivo}`,
    );
  }
  return falhas && falhas === lista.length ? 2 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('emitir.ts')) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    console.error(`[recibo] ${(e as Error).message}`);
    process.exit(1);
  });
}
