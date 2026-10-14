// Recibos vistos pelo navegador: busca /api/egos/recibos (local) a cada 30 s e paga as carteiras dos agentes
// presentes cuja sessão bate com a do recibo (uma vez por recibo; wallet.creditOnce).
import type { AgentInfo, OfficeSnapshot } from '../../shared/types';
import type { WorldApi } from '../../client/src/world/api';

export interface ProvaVista {
  tipo: string;
  nivel: string;
  digest: string;
  ref?: string;
}

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
  estado: string;
  pontos: number;
  provas: ProvaVista[];
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
  contas: LinhaPlacar[];
  clas: LinhaPlacar[];
  placar: Record<string, boolean>;
  ligado: boolean;
  confianca: number;
}

export const PROVA_ROTULO: Record<string, string> = {
  'teste-vermelho-verde': '🧪 teste vermelho→verde',
  'decisao-hitl': '✅ decisão sua registrada',
  'prova-visual': '📸 prova visual',
  'pr-ci-verde': '🟢 PR mesclado com CI verde',
};

export function recibosDoAgente(dados: RecibosResposta | null, a: Pick<AgentInfo, 'sessionId' | 'account' | 'kind'>): ReciboVisto[] {
  if (!dados || a.kind !== 'main') return [];
  return dados.recibos.filter((r) => r.sessao === a.sessionId && (!r.conta || !a.account || r.conta === a.account));
}

/** Quem recebe cada recibo agora: [agentId, recibo] dos válidos cuja sessão está no escritório. */
export function pagamentos(dados: RecibosResposta | null, snap: OfficeSnapshot | null): [string, ReciboVisto][] {
  if (!dados || !snap) return [];
  const out: [string, ReciboVisto][] = [];
  for (const a of snap.agents) {
    if (a.kind !== 'main') continue;
    for (const r of recibosDoAgente(dados, a)) if (r.valido && r.pontos > 0) out.push([a.id, r]);
  }
  return out;
}

export class RecibosStore {
  dados: RecibosResposta | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastPaid = '';

  constructor(private readonly base = '') {}

  on(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  start(everyMs = 30_000): void {
    void this.refresh();
    this.timer ??= setInterval(() => void this.refresh(), everyMs);
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/api/egos/recibos`, { cache: 'no-store' });
      if (!res.ok) return;
      this.dados = (await res.json()) as RecibosResposta;
      for (const cb of this.listeners) cb();
    } catch {
      // servidor sem a camada EGOS ou fora do ar: fica com o que tinha
    }
  }

  async setPlacar(conta: string, ligado: boolean): Promise<void> {
    await fetch(`${this.base}/api/egos/placar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conta, ligado }) });
    await this.refresh();
  }

  /** Paga as carteiras (idempotente: a carteira lembra o recibo pago). */
  pay(world: WorldApi, snap: OfficeSnapshot | null): void {
    const list = pagamentos(this.dados, snap);
    const key = `${snap?.rev ?? ''}|${list.map(([id, r]) => `${id}:${r.hash}`).join(',')}`;
    if (key === this.lastPaid || !world.creditRecibo) return;
    this.lastPaid = key;
    for (const [id, r] of list) world.creditRecibo(id, r.hash, r.pontos, `Recibo ${r.commit.slice(0, 7)} · ${r.estado}`);
  }
}

export const recibos = new RecibosStore();
