#!/usr/bin/env bun
// Saldo inicial retroativo: ninguém começa do zero. Varre os repositórios de uma pessoa no GitHub (só metadados) e
// emite um recibo HISTÓRICO por repositório, assinado, marcado origem "historico" e guardado à parte dos novos
// (~/.egos/recibos/historico/<login>/). O mesmo critério de prova vale: commit simples vale pouco, PR mesclado vale
// mais, teste visto vermelho, captura versionada e decisão humana registrada valem mais.
//
//   bun egos/recibo/historico.ts --login enioxt [--emails a@b,c@d] [--contas .claude,.claude-conta2,.codex-enio]
//
// O que sai do GitHub: contagem de commits da pessoa (GraphQL, autor = id da conta) e de PRs mesclados por repo.
// O que sai dos clones locais (quando existem): por commit da pessoa, só os CAMINHOS tocados e o título, para contar
// sinais de classe (teste, docs, governança, segurança...). Nada de conteúdo de código entra no recibo: só contagens
// e um resumo sha256 da lista de commits. Repositório privado fica marcado `privado: true` e o recibo fica na máquina.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonico, idDaChave, pubBase64, sha256 } from './recibo';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { chavePrivada, DIR_RECIBOS } from './emitir';
import { PESOS_HISTORICO, pontosHistorico, SINAIS, type ContagensHistorico, type ReciboHistorico, type Sinais } from './classes';

const HOME = homedir();

function sh(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): string {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 << 20, timeout: opts.timeout ?? 120_000, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

interface RepoGh {
  name: string;
  isPrivate: boolean;
  isFork: boolean;
  primaryLanguage?: { name: string } | null;
}

function reposDe(login: string): RepoGh[] {
  return (JSON.parse(sh('gh', ['repo', 'list', login, '--limit', '400', '--json', 'name,isPrivate,isFork,primaryLanguage'])) as RepoGh[]).filter((r) => !r.isFork);
}

/** Commits da pessoa (pelo id da conta) e PRs mesclados dela, por repo, em lotes de 8 por consulta GraphQL. */
function contagensGh(login: string, userId: string, repos: string[]): Map<string, { commits: number; prs: number }> {
  const out = new Map<string, { commits: number; prs: number }>();
  for (let i = 0; i < repos.length; i += 8) {
    const lote = repos.slice(i, i + 8);
    const q = lote
      .map(
        (r, k) =>
          `r${k}: repository(owner:${JSON.stringify(login)}, name:${JSON.stringify(r)}) { defaultBranchRef { target { ... on Commit { history(author:{id:${JSON.stringify(userId)}}) { totalCount } } } } }\n` +
          `p${k}: search(query:${JSON.stringify(`repo:${login}/${r} is:pr is:merged author:${login}`)}, type:ISSUE, first:1) { issueCount }`,
      )
      .join('\n');
    let data: Record<string, any> = {};
    try {
      data = (JSON.parse(sh('gh', ['api', 'graphql', '-f', `query=query {\n${q}\n}`])) as { data: Record<string, any> }).data ?? {};
    } catch (e) {
      console.error(`[historico] GraphQL falhou no lote ${i / 8 + 1}: ${(e as Error).message.split('\n')[0]}`);
    }
    lote.forEach((r, k) => out.set(r, { commits: data[`r${k}`]?.defaultBranchRef?.target?.history?.totalCount ?? 0, prs: data[`p${k}`]?.issueCount ?? 0 }));
  }
  return out;
}

/** Clones locais (pasta .git de verdade, não worktree) cujo origin é github.com/<login>/<repo>. */
function clonesLocais(login: string): Map<string, string> {
  const out = new Map<string, string>();
  let dirs: string[] = [];
  try {
    dirs = sh('find', [HOME, '-maxdepth', '4', '-type', 'd', '-name', '.git', '-not', '-path', '*/node_modules/*'], { timeout: 60_000 }).split('\n').filter(Boolean);
  } catch {
    dirs = [];
  }
  const re = new RegExp(`github\\.com[:/]${login}/([^/\\s]+?)(?:\\.git)?$`, 'i');
  for (const d of dirs) {
    const repo = d.slice(0, -5);
    try {
      const m = re.exec(sh('git', ['-C', repo, 'remote', 'get-url', 'origin']).trim());
      if (m && !out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), repo);
    } catch {
      // sem origin
    }
  }
  return out;
}

const EXT_LANG: Record<string, string> = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', mjs: 'JavaScript', py: 'Python', sh: 'Shell', go: 'Go', rs: 'Rust', md: 'Markdown', html: 'HTML', css: 'CSS', sql: 'SQL', yaml: 'YAML', yml: 'YAML', json: 'JSON' };

/** Sinais de classe a partir dos commits da pessoa num clone local (só caminhos e títulos). */
export function sinaisDoClone(repo: string, emails: string[]): { sinais: Sinais; contagens: Partial<ContagensHistorico>; shas: string[]; linguagens: Record<string, number> } {
  const sinais = Object.fromEntries(Object.keys(SINAIS).map((k) => [k, 0])) as Sinais;
  const linguagens: Record<string, number> = {};
  const authorArgs = emails.flatMap((e) => ['--author', e]);
  let log = '';
  try {
    log = sh('git', ['-C', repo, 'log', 'HEAD', '--no-merges', ...authorArgs, '--format=@@%H%x09%s', '--name-only'], { timeout: 300_000 });
  } catch {
    log = '';
  }
  const shas: string[] = [];
  let testeVermelhoVerde = 0;
  let provasVisuais = 0;
  const vermelho = new Set<string>();
  try {
    for (const h of sh('git', ['-C', repo, 'log', 'HEAD', '--no-merges', ...authorArgs, '--grep=^VERMELHO-ANTES: ', '--format=%H%x09%b'], { timeout: 120_000 }).split('\n')) {
      const sha = /^([0-9a-f]{40})/.exec(h)?.[1];
      if (sha) vermelho.add(sha);
    }
  } catch {
    // sem a convenção neste repo
  }
  for (const bloco of log.split('@@').filter(Boolean)) {
    const [head, ...files] = bloco.split('\n').filter(Boolean);
    const [sha, titulo = ''] = head.split('\t');
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    shas.push(sha);
    const t = titulo.toLowerCase();
    const testes = files.some((f) => /(\.test\.|\.spec\.|_test\.|(^|\/)tests?\/)/.test(f));
    const soDocs = files.length > 0 && files.every((f) => /\.(md|mdx|txt|html)$/i.test(f) || f.startsWith('docs/'));
    if (testes) sinais.teste++;
    if (vermelho.has(sha) && testes) {
      sinais.teste += 3;
      testeVermelhoVerde++;
    }
    if (soDocs) sinais.docs++;
    if (files.some((f) => /^(AGENTS\.md|CLAUDE\.md|\.guarani\/|docs\/(governance|architecture|strategy)\/)|SSOT|ARCHITECTURE|ROADMAP/i.test(f)) || /^(lei|arch|refactor)\b|arquitet/.test(t)) sinais.arquitetura++;
    if (/secur|seguran|pii|lgpd|guard|secret|segredo|vazament|hardening|auth\b/.test(t) || files.some((f) => /security|guard|pii/i.test(f))) sinais.seguranca++;
    if (/pesquis|investig|osint|research|radar|gem|forense/.test(t) || files.some((f) => /research|pesquisa|osint|investig/i.test(f))) sinais.investigacao++;
    if (/integra|conector|connector|mcp|bridge|ponte|federa|webhook|api\b|sync/.test(t)) sinais.ponte++;
    if (/^revert\b|refut|contest|cr[ií]tico|review|revis/.test(t)) sinais.contestacao++;
    if (/consolid|s[ií]ntese|resumo|mapa|handoff|relat[óo]rio|index|[íi]ndice|changelog/.test(t)) sinais.sintese++;
    if (files.some((f) => f.startsWith('docs/_proofs/') && /\.(png|jpe?g|webp)$/i.test(f))) provasVisuais++;
    for (const f of files) {
      const ext = /\.([a-z0-9]+)$/i.exec(f)?.[1]?.toLowerCase();
      const lang = ext ? EXT_LANG[ext] : undefined;
      if (lang) linguagens[lang] = (linguagens[lang] ?? 0) + 1;
    }
  }
  let decisoesHitl = 0;
  try {
    decisoesHitl = readFileSync(join(repo, 'docs/jobs/hitl-registry.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => /"decisao"\s*:\s*"[^"]/.test(l) && /"decisor"\s*:\s*"[^"]*Enio/i.test(l)).length;
  } catch {
    decisoesHitl = 0;
  }
  sinais.arquitetura += decisoesHitl * 2;
  return { sinais, contagens: { testeVermelhoVerde, provasVisuais, decisoesHitl }, shas, linguagens };
}

function assinarHistorico(corpo: Omit<ReciboHistorico, 'chave' | 'hash' | 'assinatura'>, privPem: string): ReciboHistorico {
  const priv = createPrivateKey(privPem);
  const pub = pubBase64(createPublicKey(priv));
  const completo = { ...corpo, chave: { alg: 'Ed25519' as const, id: idDaChave(pub), pub } };
  const bytes = Buffer.from(canonico(completo));
  return { ...completo, hash: sha256(bytes), assinatura: sign(null, bytes, priv).toString('base64') };
}

function projetoDe(path: string | undefined, nome: string): string {
  try {
    const nomes = JSON.parse(readFileSync(join(HOME, '.habblaud', 'nomes-egos.json'), 'utf8')) as { salas?: { re: string; nome: string }[] };
    for (const s of nomes.salas ?? []) if (new RegExp(s.re, 'i').test(path ?? `/${nome}`)) return s.nome;
  } catch {
    // sem nomes da casa
  }
  return nome;
}

async function main(argv: string[]): Promise<number> {
  const arg = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const login = arg('--login');
  if (!login) {
    console.error('uso: bun egos/recibo/historico.ts --login <github> [--emails a,b] [--contas .claude,.codex-x]');
    return 64;
  }
  const user = JSON.parse(sh('gh', ['api', `users/${login}`])) as { node_id: string; id: number };
  let emails = (arg('--emails') ?? '').split(',').filter(Boolean);
  if (!emails.length) {
    try {
      emails = [sh('git', ['config', '--global', 'user.email']).trim()].filter(Boolean);
    } catch {
      emails = [];
    }
  }
  emails.push(`${user.id}+${login}@users.noreply.github.com`, `${login}@users.noreply.github.com`);
  const contas = (arg('--contas') ?? '').split(',').filter(Boolean);
  const repos = reposDe(login);
  console.error(`[historico] ${repos.length} repositórios próprios de ${login} (sem forks); lendo contagens no GitHub…`);
  const gh = contagensGh(login, user.node_id, repos.map((r) => r.name));
  const clones = clonesLocais(login);
  const priv = chavePrivada();
  const dir = join(arg('--dir') ?? DIR_RECIBOS, 'historico', login);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const agora = new Date().toISOString();
  let total = 0;
  let emitidos = 0;
  for (const r of repos) {
    const c = gh.get(r.name) ?? { commits: 0, prs: 0 };
    const clone = clones.get(r.name.toLowerCase());
    const local = clone ? sinaisDoClone(clone, emails) : undefined;
    if (!c.commits && !c.prs && !local?.shas.length) continue;
    const contagens: ContagensHistorico = {
      commits: Math.max(c.commits, local?.shas.length ?? 0),
      prsMesclados: c.prs,
      testeVermelhoVerde: local?.contagens.testeVermelhoVerde ?? 0,
      provasVisuais: local?.contagens.provasVisuais ?? 0,
      decisoesHitl: local?.contagens.decisoesHitl ?? 0,
    };
    const sinais = local?.sinais ?? (Object.fromEntries(Object.keys(SINAIS).map((k) => [k, 0])) as Sinais);
    const recibo = assinarHistorico(
      {
        tipo: 'egos.recibo.historico',
        v: 1,
        quem: { pessoa: login, contas, origem: 'historico' },
        repo: {
          nome: r.name,
          projeto: projetoDe(clone, r.name),
          privado: r.isPrivate,
          linguagem: r.primaryLanguage?.name,
          linguagens: local?.linguagens,
          clone: !!clone,
        },
        contagens,
        sinais,
        pesos: PESOS_HISTORICO,
        pontos: pontosHistorico(contagens),
        // Resumo da lista de commits (não a lista): quem tiver o repo confere que a contagem bate.
        digest: sha256((local?.shas ?? []).slice().sort().join('\n') || `${r.name}:${contagens.commits}:${contagens.prsMesclados}`),
        quando: agora,
      },
      priv,
    );
    writeFileSync(join(dir, `${r.name}.json`), `${JSON.stringify(recibo, null, 2)}\n`, { mode: 0o644 });
    total += recibo.pontos;
    emitidos++;
    console.log(`${r.name.padEnd(34)} ${String(contagens.commits).padStart(5)} commits ${String(contagens.prsMesclados).padStart(4)} PRs ${String(contagens.testeVermelhoVerde).padStart(3)} 🧪 ${String(contagens.decisoesHitl).padStart(4)} ✅ → ${recibo.pontos} pts${clone ? '' : ' (sem clone: só contagens)'}`);
  }
  console.log(`[historico] ${emitidos} recibos históricos de ${login} em ${dir} · saldo inicial ${total} pts`);
  return 0;
}

if (process.argv[1]?.endsWith('historico.ts')) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    console.error(`[historico] ${(e as Error).message}`);
    process.exit(1);
  });
}

