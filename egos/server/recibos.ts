// Recibos no servidor do Habblaud: lê a pasta montada SOMENTE LEITURA (HABBLAUD_RECIBOS_DIR, no Docker /egos-recibos),
// verifica cada recibo (assinatura + chaves confiáveis de HABBLAUD_RECIBO_PUB) e monta o placar. Recibo inválido
// aparece como inválido e vale zero. A chave privada nunca chega aqui.
//
// Placar: opt-in por conta (desligado por padrão), gravado em <dataDir>/egos-placar.json. Clãs = sala/projeto do recibo.
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verificarRecibo, type Recibo } from '../recibo/recibo';
import { classificar, verificarHistorico, type Perfil, type ReciboHistorico } from '../recibo/classes';

export interface ReciboVisto {
  hash: string;
  valido: boolean;
  motivo?: string;
  commit: string;
  titulo: string;
  repo: string;
  projeto: string;
  pr?: number;
  conta?: string;
  sessao?: string;
  agente?: string;
  estado: Recibo['estado'] | 'INVÁLIDO';
  pontos: number;
  provas: Recibo['provas'];
  quando: string;
  chave?: string;
}

export interface LinhaPlacar {
  id: string;
  nome: string;
  pontos: number;
  recibos: number;
}

export interface RecibosResposta {
  recibos: ReciboVisto[];
  /** Só as contas que ligaram o placar. */
  contas: LinhaPlacar[];
  clas: LinhaPlacar[];
  placar: Record<string, boolean>;
  /** Saldo inicial retroativo por pessoa (recibos históricos, nunca misturados com os novos), com classe e porquê. */
  pessoas: Perfil[];
  /** Clãs pelo histórico (separado dos clãs dos recibos novos). */
  clasHistorico: LinhaPlacar[];
  /** Pasta configurada e chaves confiáveis (sem chave = aceita qualquer assinatura válida). */
  ligado: boolean;
  confianca: number;
}

const MAX_RECIBOS = 2000;

export function lerRecibos(dir: string | undefined, confiaveis: readonly string[]): ReciboVisto[] {
  if (!dir) return [];
  let nomes: string[] = [];
  try {
    nomes = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: ReciboVisto[] = [];
  for (const n of nomes.slice(0, MAX_RECIBOS)) {
    let dado: unknown;
    try {
      const p = join(dir, n);
      if (statSync(p).size > 256 * 1024) continue;
      dado = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    const v = verificarRecibo(dado, confiaveis);
    const r = (v.ok ? v.recibo : (v.recibo ?? {})) as Partial<Recibo>;
    out.push({
      hash: String(r.hash ?? n),
      valido: v.ok,
      motivo: v.ok ? undefined : v.motivo,
      commit: String(r.oque?.commit ?? ''),
      titulo: String(r.oque?.titulo ?? ''),
      repo: String(r.oque?.repo ?? ''),
      projeto: String(r.oque?.projeto ?? r.oque?.repo ?? ''),
      pr: typeof r.oque?.pr === 'number' ? r.oque.pr : undefined,
      conta: r.quem?.conta,
      sessao: r.quem?.sessao,
      agente: r.quem?.agente,
      estado: v.ok ? v.recibo.estado : 'INVÁLIDO',
      pontos: v.ok ? v.recibo.pontos : 0,
      provas: Array.isArray(r.provas) ? r.provas : [],
      quando: String(r.quando ?? ''),
      chave: r.chave?.id,
    });
  }
  return out.sort((a, b) => b.quando.localeCompare(a.quando));
}

function somar(recibos: readonly ReciboVisto[], chave: (r: ReciboVisto) => string | undefined, nome: (id: string) => string): LinhaPlacar[] {
  const m = new Map<string, LinhaPlacar>();
  for (const r of recibos) {
    if (!r.valido) continue;
    const id = chave(r);
    if (!id) continue;
    const l = m.get(id) ?? { id, nome: nome(id), pontos: 0, recibos: 0 };
    l.pontos += r.pontos;
    l.recibos++;
    m.set(id, l);
  }
  return [...m.values()].sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));
}

/** Recibos históricos: <dir>/historico/<pessoa>/*.json, verificados; um perfil por pessoa. */
export function lerHistorico(dir: string | undefined, confiaveis: readonly string[]): Perfil[] {
  if (!dir) return [];
  const base = join(dir, 'historico');
  let pessoas: string[] = [];
  try {
    pessoas = readdirSync(base);
  } catch {
    return [];
  }
  const out: Perfil[] = [];
  for (const pessoa of pessoas.slice(0, 50)) {
    const validos: ReciboHistorico[] = [];
    let nomes: string[] = [];
    try {
      nomes = readdirSync(join(base, pessoa)).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    for (const n of nomes.slice(0, 1000)) {
      try {
        const v = verificarHistorico(JSON.parse(readFileSync(join(base, pessoa, n), 'utf8')), confiaveis);
        if (v.ok && v.recibo.quem.pessoa === pessoa) validos.push(v.recibo);
      } catch {
        // ilegível: não conta
      }
    }
    const p = classificar(validos);
    if (p) out.push(p);
  }
  return out;
}

export function montarResposta(recibos: ReciboVisto[], placar: Record<string, boolean>, nomeConta: (id: string) => string, ligado: boolean, confianca: number, pessoas: Perfil[] = []): RecibosResposta {
  const hist = new Map<string, LinhaPlacar>();
  for (const p of pessoas) for (const c of p.clas) {
    const l = hist.get(c.nome) ?? { id: c.nome, nome: c.nome, pontos: 0, recibos: 0 };
    l.pontos += c.pontos;
    l.recibos++;
    hist.set(c.nome, l);
  }
  return {
    pessoas,
    clasHistorico: [...hist.values()].sort((a, b) => b.pontos - a.pontos),
    recibos,
    contas: somar(recibos, (r) => (r.conta && placar[r.conta] ? r.conta : undefined), nomeConta),
    clas: somar(recibos, (r) => r.projeto || undefined, (id) => id),
    placar,
    ligado,
    confianca,
  };
}

/** Opt-in do placar por conta, no dataDir do Habblaud. */
export class PlacarConfig {
  private cache: Record<string, boolean> | undefined;
  constructor(private readonly file: string) {}

  get(): Record<string, boolean> {
    if (this.cache) return this.cache;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { contas?: Record<string, unknown> };
      this.cache = Object.fromEntries(Object.entries(j.contas ?? {}).filter(([, v]) => v === true)) as Record<string, boolean>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  set(conta: string, ligado: boolean): Record<string, boolean> {
    const next = { ...this.get() };
    if (ligado) next[conta] = true;
    else delete next[conta];
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ contas: next }, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.cache = next;
    return next;
  }
}
