// Camada EGOS do servidor (fork enioxt/habblaud): nomes da casa e recibos de entrega. O núcleo chama só isto:
//   const egos = criarEgos({ env, dataDir, contas, isRemote });  ->  egos.namer (Office) e egos.handler (ApiDeps.extra)
//
// Rotas (só do próprio computador; pela porta remota respondem 403):
//   GET  /api/egos/recibos  -> RecibosResposta (recibos verificados, placar opt-in por conta, clãs por projeto)
//   POST /api/egos/placar   {conta, ligado} -> liga/desliga a conta no placar
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { makeEgosNamer, parseEgosNomes, type EgosNamer } from './nomes';
import { lerRecibos, montarResposta, PlacarConfig } from './recibos';

export interface EgosDeps {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  /** Nome de exibição da conta pelo id (".claude" -> "Claude · ..."). */
  contaNome: (id: string) => string | undefined;
  isRemote?: (req: IncomingMessage) => boolean;
}

export interface Egos {
  namer: EgosNamer | undefined;
  handler: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function lerCorpo(req: IncomingMessage, max = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('corpo grande demais'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

export function criarEgos(d: EgosDeps): Egos {
  const namer = makeEgosNamer(parseEgosNomes(d.env.HABBLAUD_NOMES));
  const dir = d.env.HABBLAUD_RECIBOS_DIR || undefined;
  const confiaveis = (d.env.HABBLAUD_RECIBO_PUB ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const placar = new PlacarConfig(join(d.dataDir, 'egos-placar.json'));

  const handler: Egos['handler'] = (req, res, url) => {
    const path = url.pathname;
    if (!path.startsWith('/api/egos/')) return false;
    if (d.isRemote?.(req)) {
      req.resume();
      json(res, 403, { error: 'recibos e placar só pelo próprio computador' });
      return true;
    }
    const method = req.method ?? 'GET';
    if (path === '/api/egos/recibos' && (method === 'GET' || method === 'HEAD')) {
      const recibos = lerRecibos(dir, confiaveis);
      json(res, 200, montarResposta(recibos, placar.get(), (id) => d.contaNome(id) ?? id, !!dir, confiaveis.length));
      return true;
    }
    if (path === '/api/egos/placar' && method === 'POST') {
      lerCorpo(req).then(
        (raw) => {
          let j: { conta?: unknown; ligado?: unknown } = {};
          try {
            j = JSON.parse(raw) as typeof j;
          } catch {
            j = {};
          }
          if (typeof j.conta !== 'string' || !/^[\w.@+-]{1,80}$/.test(j.conta) || typeof j.ligado !== 'boolean') {
            json(res, 400, { error: 'use {"conta": "<id>", "ligado": true|false}' });
            return;
          }
          json(res, 200, { placar: placar.set(j.conta, j.ligado) });
        },
        () => json(res, 400, { error: 'corpo inválido' }),
      );
      return true;
    }
    req.resume();
    json(res, 404, { error: 'rota EGOS desconhecida' });
    return true;
  };
  return { namer, handler };
}
