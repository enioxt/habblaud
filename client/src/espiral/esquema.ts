// ESPIRAL (visual web): confere de novo, no navegador, tudo o que a API da espiral devolve. O servidor já valida;
// aqui é a segunda camada. Regras:
// - nada é copiado da resposta: cada objeto é montado do zero, só com os campos conhecidos;
// - texto de fora nunca vira HTML (o painel usa só textContent e o mundo desenha no canvas) e, além disso, caracteres
//   de controle, de direção (bidi) e invisíveis aparecem como "[U+XXXX]", visíveis, em vez de agir;
// - link de origem só se for do github.com, em https, no formato <dono>/<repositório>/..., montado com URL e conferido
//   parte a parte.

export const PAPEIS = ['principal', 'explorador', 'planejador', 'ajudante'] as const;
export const ESTADOS = ['trabalhando', 'parado', 'esperando voce', 'saiu'] as const;
export const ATIVIDADES = ['lendo', 'escrevendo', 'testando', 'pesquisando', 'conversando'] as const;
export const LIMITES = { sala: 40, apelido: 24, login: 39, agentes: 12, presencas: 40, salas: 50, itens: 100, titulo: 200, texto: 4000 } as const;

export interface AgentePresenca {
  apelido: string;
  papel: (typeof PAPEIS)[number];
  estado: (typeof ESTADOS)[number];
  atividade?: (typeof ATIVIDADES)[number];
}
export interface Presenca {
  dono: { numero: number; login: string };
  sala: string;
  em: string;
  total: number;
  agentes: AgentePresenca[];
}
export interface Eu {
  conta: { numero: number; login: string };
  salas: string[];
}
export interface ItemMural {
  id: string;
  tipo: string;
  titulo: string;
  texto: string;
  autor: string;
  criado: string;
  atualizado: string;
  estado?: string;
  /** Link para a origem no GitHub (o diff, o commit ou o arquivo); ausente se não houver ou não passar. */
  fonte?: string;
}

/** Controle (menos \n e \t no texto longo), direção bidi, separadores de linha e invisíveis de largura zero. */
const PERIGOSOS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;
const marca = (c: string): string => `[U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`;

/** Texto de fora pronto para exibir: neutraliza o que age em vez de aparecer e corta no limite (em pontos de código). */
export function paraTexto(v: unknown, max: number, multilinha = false): string {
  if (typeof v !== 'string') return '';
  const base = multilinha ? v.replace(/\r\n?/g, '\n') : v;
  // corta primeiro (no texto original) e marca depois: a marca "[U+XXXX]" nunca sai pela metade
  const cp = [...base];
  let s = cp.length > max ? cp.slice(0, max - 1).join('') + '…' : base;
  s = s.replace(PERIGOSOS, marca);
  if (!multilinha) s = s.replace(/[\n\t]/g, marca);
  return s;
}

const objeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const naLista = <T extends string>(lista: readonly T[], v: unknown): v is T => typeof v === 'string' && (lista as readonly string[]).includes(v);
const dataOk = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const numeroOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= Number.MAX_SAFE_INTEGER;

/** Mesmo formato do servidor (dados.ts nomeFedOk): o nome vai no caminho da API. */
export const NOME_SALA = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function lerEu(x: unknown): Eu | null {
  if (!objeto(x) || x.ok !== true || !objeto(x.conta)) return null;
  const c = x.conta;
  if (!numeroOk(c.numero) || typeof c.login !== 'string') return null;
  const lista = Array.isArray(x.federacoes) ? x.federacoes : [];
  const salas = [...new Set(lista.filter((f): f is string => typeof f === 'string' && NOME_SALA.test(f)))].slice(0, LIMITES.salas);
  return { conta: { numero: c.numero, login: paraTexto(c.login, LIMITES.login) }, salas };
}

export function lerPresenca(x: unknown): Presenca | null {
  if (!objeto(x) || !objeto(x.dono)) return null;
  const d = x.dono;
  if (!numeroOk(d.numero) || typeof d.login !== 'string' || !d.login) return null;
  if (typeof x.sala !== 'string' || !x.sala || !dataOk(x.em) || !Array.isArray(x.agentes)) return null;
  const agentes: AgentePresenca[] = [];
  for (const a of x.agentes.slice(0, LIMITES.agentes)) {
    if (!objeto(a)) continue;
    const apelido = paraTexto(a.apelido, LIMITES.apelido) || '?';
    agentes.push({
      apelido,
      papel: naLista(PAPEIS, a.papel) ? a.papel : 'ajudante',
      estado: naLista(ESTADOS, a.estado) ? a.estado : 'parado',
      ...(naLista(ATIVIDADES, a.atividade) ? { atividade: a.atividade } : {}),
    });
  }
  const total = Number.isInteger(x.total) && (x.total as number) >= agentes.length && (x.total as number) <= 999 ? (x.total as number) : agentes.length;
  return { dono: { numero: d.numero, login: paraTexto(d.login, LIMITES.login) }, sala: paraTexto(x.sala, LIMITES.sala), em: x.em, total, agentes };
}

/** Lista de presenças: descarta o que não passa, uma por (conta, sala), no máximo LIMITES.presencas. */
export function lerPresencas(x: unknown): Presenca[] {
  if (!objeto(x) || x.ok !== true || !Array.isArray(x.presencas)) return [];
  const porChave = new Map<string, Presenca>();
  for (const bruto of x.presencas) {
    const p = lerPresenca(bruto);
    if (p) porChave.set(`${p.dono.numero}\u0000${p.sala}`, p);
  }
  return [...porChave.values()].slice(0, LIMITES.presencas);
}

const DONO_GH = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_GH = /^[A-Za-z0-9._-]{1,100}$/;

/** Subcaminhos de leitura aceitos depois de <dono>/<repositório> (E3). */
const SUB_GH = new Set(['blob', 'tree', 'commit', 'pull', 'issues', 'compare']);

/**
 * Só github.com em https, caminho <dono>/<repositório>/<blob|tree|commit|pull|issues|compare>/...; o resto some.
 * Com `repo` ("dono/repositório" da sala) só esse repositório passa. FASE 4: a API da espiral ainda não manda o repo da
 * sala (nem em /api/eu nem nos itens); enquanto isso só o filtro sintático vale e o repo é opcional. Quando a API mandar,
 * o store passa a repassá-lo e qualquer link de outro repositório deixa de virar botão.
 */
export function linkGithub(v: unknown, repo?: string): string | undefined {
  if (typeof v !== 'string' || v.length > 500) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.port !== '' || u.username !== '' || u.password !== '') return undefined;
  const partes = u.pathname.split('/');
  if (partes.length < 3 || partes[0] !== '' || !DONO_GH.test(partes[1]) || !REPO_GH.test(partes[2]) || partes[2] === '.' || partes[2] === '..') return undefined;
  if (!SUB_GH.has(partes[3] ?? '')) return undefined;
  if (repo !== undefined && `${partes[1]}/${partes[2]}`.toLowerCase() !== repo.toLowerCase()) return undefined;
  return u.href;
}

export function lerItens(x: unknown, repo?: string): ItemMural[] {
  if (!objeto(x) || x.ok !== true || !Array.isArray(x.itens)) return [];
  const out: ItemMural[] = [];
  for (const it of x.itens) {
    if (!objeto(it) || typeof it.id !== 'string' || !/^[a-f0-9]{16}$/.test(it.id)) continue;
    if (!dataOk(it.criado)) continue;
    const autor = objeto(it.dono) && typeof it.dono.login === 'string' ? paraTexto(it.dono.login, LIMITES.login) : '?';
    const fonte = linkGithub(it.fonte, repo);
    const estado = paraTexto(it.estado, 20);
    out.push({
      id: it.id,
      tipo: paraTexto(it.tipo, 20) || 'item',
      titulo: paraTexto(it.titulo, LIMITES.titulo) || '(sem título)',
      texto: paraTexto(it.texto, LIMITES.texto, true),
      autor,
      criado: it.criado,
      atualizado: dataOk(it.atualizado) ? it.atualizado : it.criado,
      ...(estado ? { estado } : {}),
      ...(fonte ? { fonte } : {}),
    });
  }
  out.sort((a, b) => Date.parse(b.atualizado) - Date.parse(a.atualizado));
  return out.slice(0, LIMITES.itens);
}
