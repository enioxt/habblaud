// Ponte agente -> HQ (E1): se a ação atual do agente (ou as recentes) traz o caminho de um arquivo que o HQ indexa
// (~/.egos/relatorios ou docs do kernel), devolve o link do documento no HQ. Sem caminho indexável, undefined (sem botão).
// Puro (testável). O HQ não muda: só abrimos /hq/documentos/?q=<nome do arquivo>.
import type { Activity } from '../../shared/types';

export const HQ_URL = 'http://127.0.0.1:4700';

// Documento (md/html/pdf) dentro das pastas que o HQ lê: ~/.egos/relatorios (com ~, $HOME ou Path.home()/ na frente) ou docs/ do kernel.
const CAMINHO = /(?:\.egos\/relatorios|\/egos(?:\/[^/\s"'`]+)?\/docs)\/[^\s"'`<>|;&()]+?\.(?:md|html|pdf)\b/i;

export interface DocHq {
  nome: string;
  caminho: string;
  url: string;
}

function doAtividade(a: Activity | undefined): DocHq | undefined {
  if (!a) return undefined;
  for (const campo of [a.detail, a.text]) {
    const m = campo ? CAMINHO.exec(campo) : null;
    if (!m) continue;
    const caminho = m[0].startsWith('.egos') ? `~/${m[0]}` : m[0];
    const nome = caminho.split('/').pop() ?? caminho;
    return { nome, caminho, url: `${HQ_URL}/hq/documentos/?q=${encodeURIComponent(nome)}` };
  }
  return undefined;
}

/** Documento indexável da ação atual; senão o da mais recente das recentes. */
export function docDoAgente(agent: { activity?: Activity; recent?: Activity[] } | undefined): DocHq | undefined {
  if (!agent) return undefined;
  const atual = doAtividade(agent.activity);
  if (atual) return atual;
  for (const a of [...(agent.recent ?? [])].reverse()) {
    const d = doAtividade(a);
    if (d) return d;
  }
  return undefined;
}
