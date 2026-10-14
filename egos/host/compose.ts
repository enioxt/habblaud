// Camada EGOS do `npm run docker:up` (roda no host): o que o fork acrescenta ao docker-compose.override.yml.
// - HABBLAUD_NOMES: conteúdo de ~/.habblaud/nomes-egos.json (fora do git), e os nomes das contas aplicados já aqui;
// - HABBLAUD_RECIBOS_DIR: ~/.egos/recibos montada SOMENTE LEITURA em /egos-recibos;
// - HABBLAUD_RECIBO_PUB: a chave PÚBLICA de ~/.habblaud/chave-recibo.pub (a privada nunca entra no container).
import { createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export const CONTAINER_RECIBOS_DIR = '/egos-recibos';

export interface EgosCompose {
  env: Array<[string, string]>;
  binds: { source: string; target: string }[];
}

export function lerNomes(file: string): Record<string, any> | undefined {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : undefined;
  } catch {
    return undefined;
  }
}

/** `contas` do nomes-egos.json troca o nome (e a sigla, se vier) de cada conta pelo id. */
export function aplicarNomesDeConta(accounts: { id: string; name: string; short: string }[], nomes: Record<string, any> | undefined): void {
  for (const a of accounts) {
    const c = nomes?.contas?.[a.id];
    if (c && typeof c.name === 'string') a.name = c.name;
    if (c && typeof c.short === 'string' && c.short) a.short = c.short;
  }
}

function pubBase64(pem: string): string | undefined {
  try {
    const der = createPublicKey(pem).export({ format: 'der', type: 'spki' });
    return Buffer.from(der.subarray(der.length - 32)).toString('base64');
  } catch {
    return undefined;
  }
}

export function egosCompose(home: string, env: NodeJS.ProcessEnv = process.env): EgosCompose {
  const out: EgosCompose = { env: [], binds: [] };
  const nomes = lerNomes(join(home, '.habblaud', 'nomes-egos.json'));
  if (nomes) out.env.push(['HABBLAUD_NOMES', JSON.stringify(nomes)]);
  const dir = env.EGOS_RECIBOS_DIR ?? join(home, '.egos', 'recibos');
  if (existsSync(dir)) {
    out.env.push(['HABBLAUD_RECIBOS_DIR', CONTAINER_RECIBOS_DIR]);
    out.binds.push({ source: realpathSync(dir), target: CONTAINER_RECIBOS_DIR });
  }
  const pubFile = `${env.EGOS_RECIBO_CHAVE ?? join(home, '.habblaud', 'chave-recibo')}.pub`;
  const pub = existsSync(pubFile) ? pubBase64(readFileSync(pubFile, 'utf8')) : undefined;
  if (pub) out.env.push(['HABBLAUD_RECIBO_PUB', pub]);
  return out;
}
