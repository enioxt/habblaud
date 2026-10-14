// Moldura lado a lado (E1b): deixa o HQ local enquadrar a página do Escritório em um <iframe>, e SÓ ele.
// O núcleo manda `X-Frame-Options: DENY` (clickjacking). Aqui, e só quando a requisição é uma navegação de iframe, GET,
// com Host local e fora de /api, trocamos esse DENY por `frame-ancestors <origens do HQ local>`. Qualquer outro site,
// aba normal ou acesso remoto continua barrado. O guard.ts não muda: leitura entre origens segue recusada.
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { isLoopbackHost } from '../../server/http/guard';

const PADRAO = ['http://127.0.0.1:4700', 'http://localhost:4700']; // replicavel-ok: painel local do HQ (egos-hq-local.service)

/** Lista de EGOS_HQ_ORIGENS filtrada: só `http://127.0.0.1|localhost:<porta>` sem caminho; vazia/inválida volta ao padrão. */
export function origensDoHq(raw: string | undefined): string[] {
  const ok = (raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(s));
  return ok.length ? ok : PADRAO;
}

export function permiteMoldura(req: IncomingMessage, pathname: string): boolean {
  const m = req.method ?? 'GET';
  if (m !== 'GET' && m !== 'HEAD') return false;
  if (pathname.startsWith('/api/')) return false;
  if (req.headers['sec-fetch-dest'] !== 'iframe') return false;
  return isLoopbackHost(req.headers.host);
}

/** DENY sem CSP própria vira frame-ancestors do HQ; qualquer outro cabeçalho fica como veio. */
export function cabecalhosDaMoldura(h: OutgoingHttpHeaders, origens: string[]): OutgoingHttpHeaders {
  if (String(h['X-Frame-Options']).toUpperCase() !== 'DENY' || h['Content-Security-Policy'] !== undefined) return h;
  const { 'X-Frame-Options': _descartado, ...resto } = h;
  return { ...resto, 'Content-Security-Policy': `frame-ancestors ${origens.join(' ')}` };
}

const MARCA = Symbol.for('egos.moldura.instalada');
/**
 * O núcleo só chama a camada EGOS para /api, mas o DENY sai dos estáticos (server/http/static.ts). Para não tocar no núcleo,
 * embrulhamos writeHead UMA vez no protótipo da resposta; o embrulho só age se `permiteMoldura` (iframe, GET, Host local,
 * fora de /api) e a requisição não for remota. Idempotente.
 */
export function instalarMoldura(proto: typeof ServerResponse.prototype, origens: string[], isRemote?: (req: IncomingMessage) => boolean): void {
  const alvo = proto as unknown as { writeHead: (...a: unknown[]) => unknown; [MARCA]?: boolean };
  if (alvo[MARCA]) return;
  alvo[MARCA] = true;
  const original = alvo.writeHead;
  alvo.writeHead = function (this: ServerResponse, ...args: unknown[]) {
    const i = args.findIndex((a) => a !== null && typeof a === 'object' && !Array.isArray(a));
    const req = this.req as IncomingMessage | undefined;
    if (i >= 0 && req && !isRemote?.(req) && permiteMoldura(req, (req.url ?? '/').split('?')[0])) {
      args[i] = cabecalhosDaMoldura(args[i] as OutgoingHttpHeaders, origens);
    }
    return original.apply(this, args);
  };
}
