// Recibo de entrega (EGOS): uma entrega provada vira um arquivo pequeno, assinado com Ed25519 pela chave da máquina.
// Esquema no espírito do ActionReceipt do OpenWorkProof (Apache-2.0, github.com/dengyier/OpenWorkProof): JSON
// canônico, resumo (sha256) e assinatura sobre o corpo, verificação sem internet. Os pontos nascem só das provas.
//
// O recibo NÃO guarda pedido, resposta, título de sessão nem caminho do computador. Guarda: quem (conta, papel, id da
// sessão), o quê (repo, commit, título do commit, PR), as provas (tipo, nível e resumo do que foi conferido) e quando.
// Só módulos node:* (roda no servidor do Habblaud, no Node do host e no Bun).
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const RECIBO_TIPO = 'egos.recibo';
export const RECIBO_VERSAO = 1;

/** Tipos de prova e os pontos de cada um. Tempo, tokens, mensagens, login e número de commits valem zero. */
export const PONTOS = {
  'teste-vermelho-verde': 30,
  'decisao-hitl': 25,
  'prova-visual': 20,
  'pr-ci-verde': 10,
} as const;
export type TipoProva = keyof typeof PONTOS;

/**
 * Nível de prova (níveis da casa: declarado ≠ registrado ≠ verificado):
 * - declarado: o autor afirmou no commit (ex.: VERMELHO-ANTES:) e o commit mexe no que a afirmação cita;
 * - registrado: existe um registro independente (linha no hitl-registry, captura versionada em docs/_proofs);
 * - verificado: conferido por terceiro no ato (CI verde no PR mesclado, lido do GitHub).
 */
export type NivelProva = 'declarado' | 'registrado' | 'verificado';

export interface Prova {
  tipo: TipoProva;
  nivel: NivelProva;
  /** sha256 do que foi conferido (linha do registro, blob da captura, linha VERMELHO-ANTES, lista de checks). */
  digest: string;
  /** Referência dentro do repositório (nunca caminho do computador): caso de teste, PCA, arquivo de prova, PR. */
  ref?: string;
}

/** ACEITO: há decisão humana registrada. VERIFICADO: prova independente sem decisão. DECLARADO: só a palavra do autor. */
export type EstadoRecibo = 'ACEITO' | 'VERIFICADO' | 'DECLARADO';

export interface CorpoRecibo {
  tipo: typeof RECIBO_TIPO;
  v: typeof RECIBO_VERSAO;
  esquema: string;
  quem: {
    /** Conta do Habblaud (basename da pasta: ".claude", ".codex-enio"...). */
    conta?: string;
    /** Papel ("Arquiteta", "Forja"...) quando conhecido. */
    agente?: string;
    /** Id da sessão que fez o commit (achado no transcript); fica na máquina, nunca viaja em agregado. */
    sessao?: string;
    /** Como o "quem" foi descoberto. */
    origem: 'transcript' | 'entrega' | 'manual' | 'desconhecida';
  };
  oque: {
    repo: string;
    /** Clã: sala/projeto (nome da casa quando há). */
    projeto: string;
    commit: string;
    titulo: string;
    pr?: number;
    mesclado: boolean;
  };
  provas: Prova[];
  pontos: number;
  estado: EstadoRecibo;
  /** Data do commit (ISO). */
  quando: string;
  emitidoEm: string;
  chave: { alg: 'Ed25519'; id: string; pub: string };
}

export interface Recibo extends CorpoRecibo {
  /** "sha256:<hex>" do JSON canônico do corpo. */
  hash: string;
  /** Ed25519 sobre o JSON canônico do corpo, em base64. */
  assinatura: string;
}

/** JSON canônico (chaves ordenadas, sem espaços; números inteiros), como no RFC 8785 para os tipos usados aqui. */
export function canonico(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('número não finito no recibo');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(',')}}`;
  }
  throw new Error(`tipo não suportado no recibo: ${typeof v}`);
}

export function sha256(data: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

export function pontosDe(provas: readonly Prova[]): number {
  // Um tipo conta uma vez por recibo: três capturas no mesmo commit não valem três vezes.
  return [...new Set(provas.map((p) => p.tipo))].reduce((s, t) => s + (PONTOS[t] ?? 0), 0);
}

export function estadoDe(provas: readonly Prova[]): EstadoRecibo {
  if (provas.some((p) => p.tipo === 'decisao-hitl')) return 'ACEITO';
  if (provas.some((p) => p.nivel !== 'declarado')) return 'VERIFICADO';
  return 'DECLARADO';
}

/** Chave pública crua (32 bytes) em base64, a partir de PEM/KeyObject. */
export function pubBase64(key: KeyObject): string {
  const der = key.export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - 32)).toString('base64');
}

export function pubDeBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new Error('chave pública Ed25519 precisa de 32 bytes');
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
}

/** Id curto da chave: 16 hex do sha256 da chave crua. */
export function idDaChave(pubB64: string): string {
  return createHash('sha256').update(Buffer.from(pubB64, 'base64')).digest('hex').slice(0, 16);
}

export function assinar(corpo: Omit<CorpoRecibo, 'chave'>, privPem: string): Recibo {
  const priv = createPrivateKey(privPem);
  const pub = pubBase64(createPublicKey(priv));
  const completo: CorpoRecibo = { ...corpo, chave: { alg: 'Ed25519', id: idDaChave(pub), pub } };
  const bytes = Buffer.from(canonico(completo));
  return { ...completo, hash: sha256(bytes), assinatura: sign(null, bytes, priv).toString('base64') };
}

export type ResultadoVerificacao = { ok: true; recibo: Recibo } | { ok: false; motivo: string; recibo?: Partial<Recibo> };

/**
 * Verifica sem internet: forma, resumo, assinatura, id da chave, pontos e estado recalculados a partir das provas.
 * `confiaveis` (base64 das chaves públicas aceitas): vazio = aceita qualquer chave válida, mas avisa no motivo.
 */
export function verificarRecibo(dado: unknown, confiaveis: readonly string[] = []): ResultadoVerificacao {
  if (!dado || typeof dado !== 'object') return { ok: false, motivo: 'não é um objeto' };
  const r = dado as Partial<Recibo>;
  if (r.tipo !== RECIBO_TIPO || r.v !== RECIBO_VERSAO) return { ok: false, motivo: 'tipo/versão desconhecidos', recibo: r };
  if (typeof r.hash !== 'string' || typeof r.assinatura !== 'string' || !r.chave || typeof r.chave.pub !== 'string') {
    return { ok: false, motivo: 'faltam hash, assinatura ou chave', recibo: r };
  }
  if (!Array.isArray(r.provas) || !r.provas.length) return { ok: false, motivo: 'recibo sem prova', recibo: r };
  const { hash, assinatura, ...corpo } = r as Recibo;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(canonico(corpo));
  } catch (e) {
    return { ok: false, motivo: String((e as Error).message), recibo: r };
  }
  if (sha256(bytes) !== hash) return { ok: false, motivo: 'resumo não confere (recibo alterado)', recibo: r };
  if (idDaChave(r.chave.pub) !== r.chave.id) return { ok: false, motivo: 'id da chave não confere', recibo: r };
  let okSig = false;
  try {
    okSig = verify(null, bytes, pubDeBase64(r.chave.pub), Buffer.from(assinatura, 'base64'));
  } catch {
    okSig = false;
  }
  if (!okSig) return { ok: false, motivo: 'assinatura inválida', recibo: r };
  if (confiaveis.length && !confiaveis.includes(r.chave.pub)) return { ok: false, motivo: 'chave fora da lista de confiança', recibo: r };
  if (pontosDe(r.provas) !== r.pontos) return { ok: false, motivo: 'pontos não batem com as provas', recibo: r };
  if (estadoDe(r.provas) !== r.estado) return { ok: false, motivo: 'estado não bate com as provas', recibo: r };
  return { ok: true, recibo: r as Recibo };
}
