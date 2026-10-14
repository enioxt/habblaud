// Frases curtas em PT-BR para o balão, tiradas só do evento real (a atividade que o servidor leu do transcript).
// O evento traz o comando e se deu erro; não traz o resultado (contagem de testes, número do PR criado), então a frase
// também não traz.
// Regra: se o evento não diz, a frase não diz. Nada de contagem de teste sem a saída do teste, nada de número de PR
// sem o número no comando. Puro (testável).
import type { Activity } from '../../shared/types';

export interface FraseCtx {
  /** Nome da sala/projeto (o nome da casa quando há). */
  sala?: string;
}

const MAX = 46;

function corta(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/** Primeira linha da mensagem de um `git commit` (-m "..." ou heredoc). */
export function mensagemDoCommit(cmd: string): string | undefined {
  const m = /\bgit\b[^|;&]*\bcommit\b[^|;&]*?\s-[a-zA-Z]*m\s+(?:"?\$\(cat\s+<<-?\s*'?(\w+)'?\s*\n([^\n]*)|"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(cmd);
  if (!m) return undefined;
  const msg = (m[2] ?? m[3] ?? m[4] ?? '').split('\n')[0].trim();
  return msg || undefined;
}

function comSala(text: string, ctx: FraseCtx): string {
  if (!ctx.sala || text.includes(ctx.sala)) return text;
  const t = `${text} · ${ctx.sala}`;
  return t.length <= MAX ? t : text;
}

/** Ícone e texto do balão para uma atividade real; undefined = use o texto original do Habblaud. */
export function fraseReal(act: Activity, ctx: FraseCtx = {}): { icon: string; text: string } | undefined {
  const cmd = act.detail ?? '';
  if (act.kind === 'git' || /\bgit\s+commit\b|\bgh\s+pr\b|\bgit\s+push\b/.test(cmd)) {
    const msg = mensagemDoCommit(cmd);
    if (msg) {
      if (act.error) return { icon: '⚠️', text: corta(`Commit falhou: ${msg}`, MAX) };
      return { icon: '📦', text: corta(`Commit: ${msg}`, MAX) };
    }
    const pr = /\bgh\s+pr\s+(create|merge|view|checks|review|comment)\b(?:\s+(\d+))?/.exec(cmd);
    if (pr) {
      const n = pr[2] ? ` #${pr[2]}` : '';
      const title = /--title\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(cmd);
      if (pr[1] === 'create') return { icon: '🐙', text: corta(title ? `Abrindo PR: ${title[1] ?? title[2]}` : 'Abrindo PR', MAX) };
      if (pr[1] === 'merge') return { icon: '🔀', text: `${act.error ? 'Falhou ao mesclar' : 'Mesclando'} PR${n}` };
      if (pr[1] === 'checks') return { icon: '🟢', text: `Conferindo o CI do PR${n}` };
      if (pr[1] === 'review') return { icon: '🔎', text: `Revisando PR${n}` };
      if (pr[1] === 'comment') return { icon: '💬', text: `Comentando no PR${n}` };
      return { icon: '🐙', text: `Olhando PR${n}` };
    }
    if (/\bgit\s+push\b/.test(cmd)) return { icon: '🚀', text: comSala(act.error ? 'Push recusado' : 'Enviando para o GitHub', ctx) };
  }
  if (act.kind === 'test') {
    if (act.error) return { icon: '🔴', text: comSala('Testes falharam', ctx) };
    return { icon: '🧪', text: comSala('Rodando testes', ctx) };
  }
  if (['read', 'edit', 'write', 'search', 'run'].includes(act.kind)) return { icon: act.icon, text: comSala(act.text, ctx) };
  return undefined;
}

/** "ocioso há 12 min" (só a partir de 1 min). */
export function ociosoHa(desde: number, now: number): string | undefined {
  const min = Math.floor((now - desde) / 60_000);
  if (!desde || min < 1) return undefined;
  return min < 60 ? `ocioso há ${min} min` : `ocioso há ${Math.floor(min / 60)} h ${min % 60} min`;
}

const cache = new WeakMap<Activity, { sala?: string; out: Activity }>();

/** A atividade com a frase real (mesmo objeto enquanto a atividade e a sala não mudam: sem alocar a cada quadro). */
export function atividadeReal(act: Activity | undefined, sala?: string): Activity | undefined {
  if (!act) return act;
  const c = cache.get(act);
  if (c && c.sala === sala) return c.out;
  const f = fraseReal(act, { sala });
  const out = f ? { ...act, icon: f.icon, text: f.text } : act;
  cache.set(act, { sala, out });
  return out;
}

/** Selo "real" no canto do balão: só balões que vêm de evento da sessão (o modo real não tem outros). */
export function desenharSeloReal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.save();
  ctx.font = '700 8px system-ui, sans-serif';
  const tw = ctx.measureText('real').width + 6;
  const sx = x + w - tw - 2;
  const sy = y - 5;
  ctx.fillStyle = '#1f7a4a';
  ctx.beginPath();
  ctx.roundRect(sx, sy, tw, 10, 4);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('real', sx + 3, sy + 5.5);
  ctx.restore();
}
