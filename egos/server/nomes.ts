// Nomes da casa (EGOS) para salas e personagens: configuração do Habblaud, não regra do upstream.
// Vem de HABBLAUD_NOMES (JSON; egos/host/compose.ts repassa o conteúdo de ~/.habblaud/nomes-egos.json, fora do git).
// Sem a variável, tudo continua como era (nomes do pool). Forma:
//   {
//     "principal": "Arquiteta",
//     "personagens": { "arquiteta": ["Hipátia", "Ada Lovelace"], "forja": ["Hefesto", "Dédalo"] },   // [principal, reserva]
//     "subagentes": { "forja": "Forja", "general-purpose": "Braço" },                                 // subagent_type -> papel
//     "salas": [ { "re": "/egos(/|$)", "nome": "Kernel EGOS", "arquiteta": ["Hipátia", "Ada Lovelace"] } ]  // 1º que casar vence
//   }
export interface SalaNome {
  re: string;
  nome: string;
  /** Personagens do Arquiteta desta sala ([principal, reserva]); ausente = os de "personagens.arquiteta". */
  arquiteta?: string[];
}

export interface EgosNomes {
  principal?: string;
  personagens?: Record<string, string[]>;
  subagentes?: Record<string, string>;
  salas?: SalaNome[];
}

export function parseEgosNomes(raw: string | undefined): EgosNomes | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const j = JSON.parse(raw) as EgosNomes;
    return j && typeof j === 'object' ? j : undefined;
  } catch {
    return undefined;
  }
}

const capital = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

export interface EgosNamer {
  /** Candidatos de nome do agente principal, do preferido ao último ("Arquiteta · Hipátia", "Arquiteta · Ada Lovelace"). */
  main(o: { provider?: string; accountName?: string; roomPath?: string }): string[] | undefined;
  /** Candidatos de nome do subagente pelo papel (subagent_type). */
  sub(o: { role?: string }): string[] | undefined;
  /** Nome da sala pelo caminho do projeto; undefined = o padrão do Habblaud (basename). */
  room(path: string): string | undefined;
}

export function makeEgosNamer(cfg: EgosNomes | undefined): EgosNamer | undefined {
  if (!cfg) return undefined;
  const subs = new Map(Object.entries(cfg.subagentes ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const chars = new Map(Object.entries(cfg.personagens ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const salas = (cfg.salas ?? []).flatMap((s) => {
    try {
      return [{ ...s, rx: new RegExp(s.re, 'i') }];
    } catch {
      return [];
    }
  });
  const salaOf = (path?: string) => (path ? salas.find((s) => s.rx.test(path)) : undefined);
  const withChars = (label: string, list: string[] | undefined): string[] => (list?.length ? list.map((c) => `${label} · ${c}`) : [label]);
  return {
    main: ({ provider, accountName, roomPath }) => {
      if (provider === 'codex') return [accountName || 'Codex'];
      const base = cfg.principal || undefined;
      if (!base) return undefined;
      return withChars(base, salaOf(roomPath)?.arquiteta ?? chars.get(base.toLowerCase()));
    },
    sub: ({ role }) => {
      if (!role) return undefined;
      const key = (role.split(':').pop() ?? role).toLowerCase();
      const label = subs.get(role.toLowerCase()) ?? subs.get(key) ?? capital(role.split(':').pop() ?? role);
      return withChars(label, chars.get(label.toLowerCase()) ?? chars.get(key));
    },
    room: (path) => salaOf(path)?.nome,
  };
}

/** Primeiro candidato livre; se todos estão em uso, o primeiro com "2", "3"... */
export function primeiroLivre(cands: readonly string[], used: ReadonlySet<string>): string {
  for (const c of cands) if (!used.has(c)) return c;
  for (let k = 2; ; k++) if (!used.has(`${cands[0]} ${k}`)) return `${cands[0]} ${k}`;
}

/**
 * Nome da casa por sala, aplicado sobre os nomes padrão (basename). Duas salas com o mesmo nome da casa (ex.: o repo e
 * um worktree dele) ficam distintas pelo basename: a de caminho mais curto leva o nome limpo. Renomear pela interface
 * (alias do 0.11.0) continua valendo por cima disto.
 */
export function aplicarNomesDeSala(names: Map<string, string>, paths: ReadonlyMap<string, string>, namer: EgosNamer | undefined): void {
  if (!namer) return;
  const byName = new Map<string, string[]>();
  for (const [id, path] of paths) {
    const n = namer.room(path);
    if (n) byName.set(n, [...(byName.get(n) ?? []), id]);
  }
  for (const [n, ids] of byName) {
    ids.sort((a, b) => paths.get(a)!.length - paths.get(b)!.length || a.localeCompare(b));
    ids.forEach((id, i) => names.set(id, i === 0 ? n : `${n} · ${names.get(id)}`));
  }
}
