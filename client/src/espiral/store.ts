// ESPIRAL (visual web): o store do mundo alimentado SÓ pela API da espiral, na mesma origem, sob /espiralcoletiva.
// O mundo (client/src/world) usa dele só `snapshot` e `on('snapshot')` (world/index.ts, WorldStore). Nada aqui fala
// com o Habblaud local (endereço, porta ou fluxo do servidor dele) nem com outro domínio: só fetch relativo à origem
// (pacote.test.ts varre o código e o pacote atrás disso).
import type { OfficeSnapshot } from '../../../shared/types';
import { Mistura, montarSnapshot } from './converter';
import { lerEu, lerItens, lerPresencas, NOME_SALA, type Eu, type ItemMural, type Presenca } from './esquema';

export const BASE = '/espiralcoletiva';

/** fora: sem sessão · sem-salas: conectado sem nenhuma espiral · sem-acesso: perdeu a sala aberta · erro: sem resposta. */
export type Fase = 'carregando' | 'fora' | 'sem-salas' | 'sem-acesso' | 'pronto' | 'erro';

export interface EstadoEspiral {
  fase: Fase;
  eu?: Eu;
  sala?: string;
  presencas: Presenca[];
  itens: ItemMural[];
  /** Aviso curto para a pessoa (texto pronto; nunca vem cru do servidor). */
  aviso?: string;
  atualizadoEm?: number;
}

type Busca = (url: string, init?: RequestInit) => Promise<Response>;
type Ouvinte = () => void;

export class EspiralStore {
  snapshot: OfficeSnapshot | null = null;
  estado: EstadoEspiral = { fase: 'carregando', presencas: [], itens: [] };
  readonly mistura = new Mistura();
  private ouvintes = { snapshot: new Set<Ouvinte>(), estado: new Set<Ouvinte>() };
  private rev = 0;
  private readonly inicio: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private escolhida: string | undefined;
  private emCurso: Promise<void> | null = null;
  /** Geração da escolha: cada volta guarda a sua e descarta o resultado se a escolha mudou no caminho (E2). */
  private geracao = 0;
  private aoVoltarAba: (() => void) | undefined;

  constructor(
    private readonly busca: Busca = (u, i) => fetch(u, i),
    private readonly agora: () => number = Date.now,
  ) {
    this.inicio = agora();
  }

  on(evento: 'snapshot' | 'estado', cb: Ouvinte): () => void {
    const set = this.ouvintes[evento];
    set.add(cb);
    return () => void set.delete(cb);
  }

  private emitir(evento: 'snapshot' | 'estado'): void {
    for (const cb of this.ouvintes[evento]) {
      try {
        cb();
      } catch (e) {
        console.error('[espiral] ouvinte falhou', e);
      }
    }
  }

  /**
   * Atualiza agora e a cada `cadaMs` (15 s); pula enquanto a aba está escondida e atualiza na hora quando ela volta a
   * ficar visível. TETO DE REVOGAÇÃO: sem fluxo de eventos neste visual (pacote.test.ts o proíbe), a perda de acesso aparece
   * em até 15 s com a aba aberta, ou ao voltar para a aba. Esse teto é o aceite da Fase 3.
   */
  start(cadaMs = 15_000): void {
    void this.atualizar();
    if (typeof document !== 'undefined' && !this.aoVoltarAba) {
      this.aoVoltarAba = () => {
        if (!document.hidden) void this.atualizar();
      };
      document.addEventListener('visibilitychange', this.aoVoltarAba);
    }
    this.timer ??= setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void this.atualizar();
    }, cadaMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.aoVoltarAba && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.aoVoltarAba);
    this.aoVoltarAba = undefined;
  }

  escolherSala(sala: string): void {
    if (!NOME_SALA.test(sala) || !this.estado.eu?.salas.includes(sala) || sala === this.estado.sala) return;
    this.escolhida = sala;
    this.geracao++; // a volta em voo (da sala antiga) passa a ser descartada
    this.emCurso = null; // e a escolha nunca é absorvida por ela
    this.mistura.limpar(); // não deixa salas da outra espiral saindo devagar
    this.estado = { ...this.estado, sala, presencas: [], itens: [], aviso: undefined };
    void this.atualizar();
  }

  private async pedir(caminho: string): Promise<{ status: number; corpo: unknown }> {
    const res = await this.busca(`${BASE}/${caminho}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
    let corpo: unknown = null;
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      try {
        corpo = await res.json();
      } catch {
        corpo = null;
      }
    }
    return { status: res.status, corpo };
  }

  /** Uma volta completa: conta e salas, depois presença e itens da sala escolhida. Volta concorrente espera a atual. */
  atualizar(): Promise<void> {
    if (this.emCurso) return this.emCurso;
    const minha: Promise<void> = this.volta(this.geracao).finally(() => {
      if (this.emCurso === minha) this.emCurso = null;
    });
    this.emCurso = minha;
    return minha;
  }

  private async volta(gen: number): Promise<void> {
    const velha = () => gen !== this.geracao;
    try {
      const r = await this.pedir('api/eu');
      if (velha()) return;
      if (r.status === 401) return this.mudar({ fase: 'fora', presencas: [], itens: [] }, true);
      const eu = r.status === 200 ? lerEu(r.corpo) : null;
      if (!eu) return this.falhou();
      if (!eu.salas.length) return this.mudar({ fase: 'sem-salas', eu, presencas: [], itens: [] }, true);

      const perdeu = !!this.escolhida && !eu.salas.includes(this.escolhida);
      const sala = this.escolhida && eu.salas.includes(this.escolhida) ? this.escolhida : eu.salas[0];
      this.escolhida = sala;
      const seg = encodeURIComponent(sala);
      const [rp, ri] = await Promise.all([this.pedir(`api/f/${seg}/presenca`), this.pedir(`api/f/${seg}/itens`)]);
      if (velha()) return;
      if (rp.status === 401 || ri.status === 401) return this.mudar({ fase: 'fora', presencas: [], itens: [] }, true);
      if (rp.status === 403 || ri.status === 403) {
        // a conta ainda lista a sala, mas a sala recusou: perda de acesso, sem dados da sala nem agentes no canvas
        return this.mudar({ fase: 'sem-acesso', eu, sala, presencas: [], itens: [], aviso: 'Seu acesso a este projeto mudou.' }, true);
      }
      if (rp.status !== 200 || ri.status !== 200) return this.falhou();
      const presencas = lerPresencas(rp.corpo);
      const itens = lerItens(ri.corpo);
      this.mudar({ fase: 'pronto', eu, sala, presencas, itens, aviso: perdeu ? 'Seu acesso a um projeto mudou.' : undefined }, true);
    } catch {
      if (!velha()) this.falhou();
    }
  }

  /** Sem resposta boa: mantém o último estado visível e avisa. */
  private falhou(): void {
    if (this.estado.fase === 'carregando') this.mudar({ fase: 'erro', presencas: [], itens: [], aviso: 'Não foi possível falar com a espiral agora. Tente em instantes.' }, false);
    else this.mudar({ ...this.estado, aviso: 'Sem resposta da espiral: mostrando o último estado.' }, false);
  }

  private mudar(novo: EstadoEspiral, refazMundo: boolean): void {
    const agora = this.agora();
    this.estado = { ...novo, atualizadoEm: refazMundo ? agora : this.estado.atualizadoEm };
    if (refazMundo) {
      if (novo.fase !== 'pronto') this.mistura.limpar(); // sem acesso, sem sessão ou sem salas: nada da sala anterior sai devagar
      const conv = this.mistura.atualizar(novo.fase === 'pronto' ? novo.presencas : [], agora);
      this.snapshot = novo.fase === 'pronto' && novo.sala ? montarSnapshot(novo.sala, conv, ++this.rev, agora, this.inicio) : montarVazio(++this.rev, agora, this.inicio);
      this.emitir('snapshot');
    }
    this.emitir('estado');
  }
}

/** Sem sala: prédio vazio (o mundo ainda desenha a recepção e o corredor). */
function montarVazio(rev: number, agora: number, inicio: number): OfficeSnapshot {
  return { rev, serverTime: agora, rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: inicio, version: 'espiral' } };
}
