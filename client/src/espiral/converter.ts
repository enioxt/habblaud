// ESPIRAL (visual web): transforma o que a API da espiral devolve em sala e agentes SINTÉTICOS para o mundo.
// Origem: converterSala e Mistura de egos/client/coop.ts (ramo egos/coop, commit 2a63115), com duas mudanças:
// o nome da sala passa a ser "login · sala" e as vagas começam em 1 (a vaga 0 é a sala do projeto).
// Função pura, sem DOM e sem rede: o teste roda no Node.
import { hash32 } from '../../../shared/hash';
import type { AccountInfo, ActivityKind, AgentInfo, AgentStatus, OfficeSnapshot, RoomInfo } from '../../../shared/types';
import type { Presenca } from './esquema';

export const SAIDA_MS = 60_000;
export const CONTA_ESPIRAL = 'espiral';
export const CONTA_SINTETICA: AccountInfo = { id: CONTA_ESPIRAL, short: 'E', name: 'Espiral', color: '#8b98b3', configDir: '', sessions: 0, usageStatus: 'disabled' };

const STATUS: Record<string, AgentStatus> = { trabalhando: 'working', 'esperando voce': 'waiting', parado: 'idle', saiu: 'offline' };
const ATIV: Record<string, { kind: ActivityKind; icon: string; texto: string }> = {
  lendo: { kind: 'read', icon: '📖', texto: 'Lendo' },
  escrevendo: { kind: 'write', icon: '✏️', texto: 'Escrevendo' },
  testando: { kind: 'test', icon: '🧪', texto: 'Testando' },
  pesquisando: { kind: 'search', icon: '🔎', texto: 'Pesquisando' },
  conversando: { kind: 'respond', icon: '💬', texto: 'Conversando' },
};

export const idSalaProjeto = (fed: string): string => `espiral:projeto:${fed}`;
export const idSala = (p: Pick<Presenca, 'dono' | 'sala'>): string => `espiral:${p.dono.numero}:${p.sala}`;
export const nomeSala = (p: Pick<Presenca, 'dono' | 'sala'>): string => `${p.dono.login} · ${p.sala}`;

/** Uma presença publicada vira uma sala. `saindo` = a presença sumiu (agentes offline; a sala sai depois de SAIDA_MS). */
export function converterSala(p: Presenca, slot: number, agora: number, saindo: boolean): { room: RoomInfo; agents: AgentInfo[] } {
  const id = idSala(p);
  const room: RoomInfo = { id, name: nomeSala(p), path: '', slot, seed: hash32(id), createdAt: agora };
  const principal = p.agentes.findIndex((a) => a.papel === 'principal');
  const agents = p.agentes.map((a, i): AgentInfo => {
    const aid = `${id}:${i}`;
    const st = saindo ? 'offline' : (STATUS[a.estado] ?? 'idle');
    const at = a.atividade ? ATIV[a.atividade] : undefined;
    const main = a.papel === 'principal' || principal < 0 || i === principal;
    return {
      id: aid, kind: main ? 'main' : 'sub', ...(main ? {} : { parentId: `${id}:${principal}` }), roomId: id,
      name: a.apelido, look: hash32(aid) % 2 ? 'f' : 'm', role: a.papel, sessionId: aid, account: CONTA_ESPIRAL, status: st,
      ...(st === 'waiting' ? { waitingFor: 'esperando você' } : {}),
      ...(at && st === 'working' ? { activity: { id: `${aid}:a`, kind: at.kind, icon: at.icon, text: at.texto, at: agora } } : {}),
      recent: [], tasks: [], startedAt: agora - 60_000 + i, lastEventAt: agora, statusSince: agora,
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: hash32(aid),
    };
  });
  return { room, agents };
}

/** Mantém quem já apareceu (vaga estável) e dá a volta de saída (60 s) para quem sumiu da lista. */
export class Mistura {
  private salas = new Map<string, { p: Presenca; slot: number; fora?: number }>();
  private proximoSlot = 1;

  atualizar(presencas: Presenca[], agora: number): { rooms: RoomInfo[]; agents: AgentInfo[] } {
    const atuais = new Set<string>();
    for (const p of presencas) {
      const id = idSala(p);
      atuais.add(id);
      const antes = this.salas.get(id);
      this.salas.set(id, { p, slot: antes?.slot ?? this.proximoSlot++ });
    }
    for (const [id, s] of this.salas) {
      if (atuais.has(id)) continue;
      s.fora ??= agora;
      if (agora - s.fora > SAIDA_MS) this.salas.delete(id);
    }
    const rooms: RoomInfo[] = [];
    const agents: AgentInfo[] = [];
    for (const s of [...this.salas.values()].sort((a, b) => a.slot - b.slot)) {
      const c = converterSala(s.p, s.slot, agora, s.fora !== undefined);
      rooms.push(c.room);
      agents.push(...c.agents);
    }
    return { rooms, agents };
  }

  /** Troca de espiral: esquece todas as salas (sem volta de saída). */
  limpar(): void {
    this.salas.clear();
  }

  /** Presença de uma sala ou de um agente (para o painel ao clicar). */
  doId(id: string): { p: Presenca; i?: number } | undefined {
    for (const [sid, s] of this.salas) {
      if (id === sid) return { p: s.p };
      if (id.startsWith(sid + ':')) {
        const i = Number(id.slice(sid.length + 1));
        if (Number.isInteger(i) && i >= 0 && i < s.p.agentes.length) return { p: s.p, i };
      }
    }
    return undefined;
  }
}

/** O retrato que o mundo desenha: a sala do projeto na vaga 0 e uma sala por presença publicada. */
export function montarSnapshot(fed: string, conv: { rooms: RoomInfo[]; agents: AgentInfo[] }, rev: number, agora: number, inicio: number): OfficeSnapshot {
  const pid = idSalaProjeto(fed);
  const projeto: RoomInfo = { id: pid, name: `Sala do projeto · ${fed}`, path: '', slot: 0, seed: hash32(pid), createdAt: inicio };
  return {
    rev,
    serverTime: agora,
    rooms: [projeto, ...conv.rooms],
    agents: conv.agents,
    accounts: [CONTA_SINTETICA],
    meta: { demo: false, sources: [], startedAt: inicio, version: 'espiral' },
  };
}

/** "agora há pouco" / "há N min" / "há N h" / data. */
export function haQuanto(em: string, agora: number): string {
  const t = Date.parse(em);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((agora - t) / 1000));
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `há ${Math.round(s / 3600)} h`;
  return em.slice(0, 10).split('-').reverse().join('/');
}
