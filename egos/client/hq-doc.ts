// Ponte agente -> HQ (E1): se a ação atual do agente (ou as recentes) traz o caminho de um arquivo que o HQ indexa
// (~/.egos/relatorios ou docs do kernel), devolve o link do documento no HQ. Sem caminho indexável, undefined (sem botão).
// Puro (testável). O HQ não muda: só abrimos /hq/documentos/?q=<nome do arquivo>.
import type { Activity } from '../../shared/types';

export const HQ_URL = 'http://127.0.0.1:4700';

// Documento (md/html/pdf) dentro das pastas que o HQ lê: ~/.egos/relatorios (com ~, $HOME ou Path.home()/ na frente) ou docs/ do kernel.
// No HQ: documentos na raiz de relatorios/ ou 1 nível abaixo (frente). revisao-codex/ ele não indexa (medido: 0 de 162).
const RELATORIO = /\.egos\/relatorios\/(?!revisao-codex\/)(?:[^/\s"'`<>|;&()]+\/)?[^/\s"'`<>|;&()]+?\.(?:md|html|pdf)\b/i;
const KERNEL = /\/egos(?:\/[^/\s"'`]+)?\/docs\/[^\s"'`<>|;&()]+?\.(?:md|html|pdf)\b/i;

export interface DocHq {
  nome: string;
  caminho: string;
  url: string;
}

function doAtividade(a: Activity | undefined): DocHq | undefined {
  if (!a) return undefined;
  for (const campo of [a.detail, a.text]) {
    const m = campo ? (RELATORIO.exec(campo) ?? KERNEL.exec(campo)) : null;
    if (!m) continue;
    const caminho = m[0].startsWith('.egos') ? `~/${m[0]}` : m[0];
    const nome = caminho.split('/').pop() ?? caminho;
    // O HQ busca pelo nome sem extensão (com ".md" a busca volta vazia) e, para docs de agentes, na aba "Tudo".
    const busca = nome.replace(/\.(?:md|html|pdf)$/i, '');
    return { nome, caminho, url: `${HQ_URL}/hq/documentos/?publico=tudo&q=${encodeURIComponent(busca)}` };
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
