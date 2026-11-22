// ESPIRAL (visual web): o adaptador com respostas FICTÍCIAS da API (nenhum dado real de pessoa).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { idSalaProjeto } from './converter';
import { linkGithub, paraTexto } from './esquema';
import { montarPainel } from './painel';
import { EspiralStore } from './store';

const ISCA_HTML = '<img src=x onerror=alert(1)>';
const ISCA_CURTA = '<img onerror=x>'; // cabe no limite de 24 do apelido
const RLO = '\u202E'; // direção invertida (RIGHT-TO-LEFT OVERRIDE)
const ISOLA = '\u2066'; // LEFT-TO-RIGHT ISOLATE
const AGORA = Date.parse('2026-11-22T12:00:00.000Z');

type Rota = (url: string) => { status: number; corpo?: unknown } | 'cai';

function falsa(rota: Rota) {
  const pedidos: { url: string; init?: RequestInit }[] = [];
  const busca = async (url: string, init?: RequestInit): Promise<Response> => {
    pedidos.push({ url, init });
    const r = rota(url);
    if (r === 'cai') throw new TypeError('rede fora');
    return new Response(r.corpo === undefined ? '' : JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { busca, pedidos };
}

const eu = (salas: string[]) => ({ ok: true, conta: { numero: 1001, login: 'ana-teste' }, federacoes: salas });
const presenca = (numero: number, login: string, sala: string, extra: Record<string, unknown> = {}) => ({
  dono: { numero, login }, em: '2026-11-22T11:58:00.000Z', v: 1, sala, total: 2,
  agentes: [{ apelido: 'Lince', papel: 'principal', estado: 'trabalhando', atividade: 'lendo' }, { apelido: 'Coruja', papel: 'ajudante', estado: 'parado' }],
  ...extra,
});
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, federacao: 'x', dono: { numero: 1002, login: 'bruno-teste' }, tipo: 'cartao', titulo: 'Plano da semana', texto: 'linha 1\nlinha 2', nivel: 1,
  criado: '2026-11-21T10:00:00.000Z', atualizado: '2026-11-21T10:00:00.000Z', historico: [], ...extra,
});

function api(salas: string[], porSala: Record<string, { presencas: unknown[]; itens: unknown[] }>): Rota {
  return (url) => {
    if (url === '/espiralcoletiva/api/eu') return { status: 200, corpo: eu(salas) };
    const m = /^\/espiralcoletiva\/api\/f\/([^/]+)\/(presenca|itens)$/.exec(url);
    const s = m && porSala[decodeURIComponent(m[1])];
    if (!m || !s) return { status: 403, corpo: { ok: false, erro: 'sem acesso' } };
    return { status: 200, corpo: m[2] === 'presenca' ? { ok: true, presencas: s.presencas } : { ok: true, itens: s.itens } };
  };
}

function soMesmaOrigem(pedidos: { url: string; init?: RequestInit }[]): void {
  for (const p of pedidos) {
    expect(p.url.startsWith('/espiralcoletiva/api/')).toBe(true);
    expect(p.url).not.toMatch(/127\.0\.0\.1|localhost|4747|:\/\//);
    expect(p.init?.credentials).toBe('same-origin');
    expect(p.init?.method).toBe('GET');
  }
}

describe('EspiralStore: 0, 1 e 2 salas', () => {
  it('0 salas: tela "não participa", prédio vazio, nenhuma chamada de sala', async () => {
    const { busca, pedidos } = falsa(api([], {}));
    const store = new EspiralStore(busca, () => AGORA);
    let avisos = 0;
    store.on('snapshot', () => avisos++);
    await store.atualizar();
    expect(store.estado.fase).toBe('sem-salas');
    expect(store.estado.eu?.conta.login).toBe('ana-teste');
    expect(store.snapshot?.rooms).toEqual([]);
    expect(avisos).toBe(1);
    expect(pedidos.map((p) => p.url)).toEqual(['/espiralcoletiva/api/eu']);
    soMesmaOrigem(pedidos);
  });

  it('1 sala: sala do projeto na vaga 0 e uma sala "login · sala" por presença publicada', async () => {
    const { busca, pedidos } = falsa(api(['sala-a'], { 'sala-a': { presencas: [presenca(1002, 'bruno-teste', 'Loja nova'), presenca(1003, 'carla-teste', 'Site')], itens: [item('aaaaaaaaaaaaaaaa')] } }));
    const store = new EspiralStore(busca, () => AGORA);
    await store.atualizar();
    expect(store.estado.fase).toBe('pronto');
    expect(store.estado.sala).toBe('sala-a');
    const snap = store.snapshot!;
    expect(snap.rooms[0]).toMatchObject({ id: idSalaProjeto('sala-a'), name: 'Sala do projeto · sala-a', slot: 0 });
    expect(snap.rooms.slice(1).map((r) => r.name)).toEqual(['bruno-teste · Loja nova', 'carla-teste · Site']);
    expect(snap.agents).toHaveLength(4);
    expect(snap.agents[0]).toMatchObject({ name: 'Lince', status: 'working', kind: 'main' });
    expect(snap.agents[1]).toMatchObject({ name: 'Coruja', status: 'idle', kind: 'sub' });
    expect(store.estado.itens).toHaveLength(1);
    expect(pedidos.map((p) => p.url).sort()).toEqual(['/espiralcoletiva/api/eu', '/espiralcoletiva/api/f/sala-a/itens', '/espiralcoletiva/api/f/sala-a/presenca']);
    soMesmaOrigem(pedidos);
  });

  it('2 salas: começa na primeira, troca pelo seletor e ignora sala que a conta não tem', async () => {
    const { busca, pedidos } = falsa(api(['sala-a', 'sala-b'], {
      'sala-a': { presencas: [presenca(1002, 'bruno-teste', 'Loja nova')], itens: [] },
      'sala-b': { presencas: [], itens: [item('bbbbbbbbbbbbbbbb')] },
    }));
    const store = new EspiralStore(busca, () => AGORA);
    await store.atualizar();
    expect(store.estado.eu?.salas).toEqual(['sala-a', 'sala-b']);
    expect(store.estado.sala).toBe('sala-a');
    store.escolherSala('sala-b');
    await store.atualizar();
    expect(store.estado.sala).toBe('sala-b');
    expect(store.snapshot!.rooms.map((r) => r.name)).toEqual(['Sala do projeto · sala-b']); // sem salas da outra espiral saindo
    const antes = pedidos.length;
    store.escolherSala('sala-c');
    store.escolherSala('../api/token');
    store.escolherSala('sala-a/../sala-b');
    expect(pedidos.length).toBe(antes);
    expect(store.estado.sala).toBe('sala-b');
    soMesmaOrigem(pedidos);
  });

  it('nome de sala fora do formato vindo da API é descartado antes de virar caminho', async () => {
    const { busca, pedidos } = falsa(api(['../token', 'Sala A', 'sala-ok', 'x'.repeat(41)], { 'sala-ok': { presencas: [], itens: [] } }));
    const store = new EspiralStore(busca, () => AGORA);
    await store.atualizar();
    expect(store.estado.eu?.salas).toEqual(['sala-ok']);
    soMesmaOrigem(pedidos);
  });
});

describe('EspiralStore: sessão, acesso e rede', () => {
  it('401 vira "fora"; 403 na sala vira aviso de acesso mudado, sem dados da sala', async () => {
    const fora = new EspiralStore(falsa(() => ({ status: 401, corpo: { ok: false, reentrar: true, reentrar_url: 'https://mal.example/x' } })).busca, () => AGORA);
    await fora.atualizar();
    expect(fora.estado.fase).toBe('fora');

    const { busca } = falsa((url) => (url.endsWith('/api/eu') ? { status: 200, corpo: eu(['sala-a']) } : { status: 403, corpo: { ok: false } }));
    const negada = new EspiralStore(busca, () => AGORA);
    await negada.atualizar();
    expect(negada.estado.aviso).toBe('Seu acesso a este projeto mudou.');
    expect(negada.estado.presencas).toEqual([]);
    expect(negada.snapshot!.agents).toEqual([]);
  });

  it('rede caiu depois de carregar: mantém o último estado e avisa', async () => {
    let cair = false;
    const { busca } = falsa((url) => (cair ? 'cai' : api(['sala-a'], { 'sala-a': { presencas: [presenca(1002, 'bruno-teste', 'Loja nova')], itens: [] } })(url)));
    const store = new EspiralStore(busca, () => AGORA);
    await store.atualizar();
    cair = true;
    await store.atualizar();
    expect(store.estado.fase).toBe('pronto');
    expect(store.estado.presencas).toHaveLength(1);
    expect(store.estado.aviso).toMatch(/último estado/);
  });

  it('presença que some fica 60 s saindo (agentes offline) e depois a sala sai', async () => {
    let t = AGORA;
    let com = true;
    const { busca } = falsa((url) => api(['sala-a'], { 'sala-a': { presencas: com ? [presenca(1002, 'bruno-teste', 'Loja nova')] : [], itens: [] } })(url));
    const store = new EspiralStore(busca, () => t);
    await store.atualizar();
    com = false;
    t += 15_000;
    await store.atualizar();
    expect(store.snapshot!.agents.every((a) => a.status === 'offline')).toBe(true);
    t += 61_000;
    await store.atualizar();
    expect(store.snapshot!.rooms).toHaveLength(1);
  });
});

describe('iscas: texto de fora aparece como texto', () => {
  const maliciosa = presenca(1004, ISCA_HTML, `${RLO}lanoitan${ISCA_HTML}`, { dono: { numero: 1004, login: `${ISCA_HTML}${RLO}`, cpf: '000.000.000-00' } });
  (maliciosa.agentes as unknown[]).push({ apelido: `${ISOLA}${ISCA_CURTA}`, papel: 'admin', estado: 'dono-do-mundo', atividade: 'rm -rf', segredo: 'x' });
  const itens = [
    item('cccccccccccccccc', { titulo: ISCA_HTML, texto: `${RLO}txt.exe\n<script>alert(1)</script>`, fonte: 'https://github.com/exemplo/repo/commit/0123abc' }),
    item('dddddddddddddddd', { titulo: 'js', fonte: 'javascript:alert(1)' }),
    item('eeeeeeeeeeeeeeee', { titulo: 'host parecido', fonte: 'https://github.com.mal.example/exemplo/repo' }),
    item('ffffffffffffffff', { titulo: 'com usuário', fonte: 'https://x@github.com/exemplo/repo' }),
    item('<b>naohex</b>0000', { titulo: 'id ruim' }),
  ];
  const rota = api(['sala-a'], { 'sala-a': { presencas: [maliciosa], itens } });

  it('o retrato do mundo leva a isca como texto literal, sem bidi, sem campo desconhecido', async () => {
    const store = new EspiralStore(falsa(rota).busca, () => AGORA);
    await store.atualizar();
    const snap = store.snapshot!;
    const sala = snap.rooms[1];
    expect(sala.name).toContain(ISCA_HTML);
    expect(sala.name).toContain('[U+202E]');
    expect(sala.name).not.toContain(RLO);
    const ag = snap.agents[2];
    expect(ag.name).toBe(`[U+2066]${ISCA_CURTA}`);
    expect(ag.role).toBe('ajudante'); // papel fora da lista cai no neutro
    expect(ag.status).toBe('idle');
    expect(ag.activity).toBeUndefined();
    const tudo = JSON.stringify(snap);
    expect(tudo).not.toContain('000.000.000-00');
    expect(tudo).not.toContain('segredo');
    expect(tudo).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  it('itens: título e texto como texto; só link do GitHub conferido sobrevive', async () => {
    const store = new EspiralStore(falsa(rota).busca, () => AGORA);
    await store.atualizar();
    const its = store.estado.itens;
    expect(its.map((i) => i.id)).not.toContain('<b>naohex</b>0000');
    const isca = its.find((i) => i.id === 'cccccccccccccccc')!;
    expect(isca.titulo).toBe(ISCA_HTML);
    expect(isca.texto).toBe('[U+202E]txt.exe\n<script>alert(1)</script>');
    expect(isca.fonte).toBe('https://github.com/exemplo/repo/commit/0123abc');
    expect(its.filter((i) => i.fonte).length).toBe(1);
  });

  it('painel: tudo entra como nó de texto; nenhum elemento img/script nasce; hrefs só os esperados', async () => {
    const doc = instalarDomFalso();
    const store = new EspiralStore(falsa(rota).busca, () => AGORA);
    const raiz = doc.createElement('aside');
    let aoSelecionar: ((s: unknown) => void) | undefined;
    const world = { select: () => undefined, onSelect: (cb: (s: unknown) => void) => ((aoSelecionar = cb), () => undefined) };
    montarPainel(raiz as unknown as HTMLElement, store, world as never);
    await store.atualizar();
    aoSelecionar?.({ type: 'agent', id: store.snapshot!.agents[2].id });
    const textos = coletar(raiz, (n) => (n instanceof TextoFalso ? n.data : undefined));
    const tags = coletar(raiz, (n) => (n instanceof ElFalso ? n.tag : undefined));
    const hrefs = coletar(raiz, (n) => (n instanceof ElFalso && n.tag === 'a' ? n.href : undefined));
    expect(textos.some((t) => t.includes(ISCA_HTML))).toBe(true);
    expect(textos.some((t) => t.includes('<script>alert(1)</script>'))).toBe(true);
    expect(textos.join('')).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(tags).not.toContain('img');
    expect(tags).not.toContain('script');
    expect(new Set(hrefs)).toEqual(new Set(['./LICENSE.txt', '/espiralcoletiva/', 'https://github.com/exemplo/repo/commit/0123abc']));
    const gh = achar(raiz, (n) => n instanceof ElFalso && n.href.startsWith('https://github.com/')) as ElFalso;
    expect(gh.rel).toBe('noopener noreferrer');
    expect(gh.target).toBe('_blank');
    expect(doc.innerHtmlTentativas).toBe(0);
  });
});

describe('esquema: funções puras', () => {
  it('paraTexto marca controle, bidi e invisíveis; corta em pontos de código', () => {
    expect(paraTexto(`a${RLO}b\u200Bc\u0000d`, 99)).toBe('a[U+202E]b[U+200B]c[U+0000]d');
    expect(paraTexto('linha\nnova', 99)).toBe('linha[U+000A]nova');
    expect(paraTexto('linha\r\nnova', 99, true)).toBe('linha\nnova');
    expect(paraTexto('😀😀😀😀', 3)).toBe('😀😀…');
    expect(paraTexto({ toString: () => ISCA_HTML }, 99)).toBe('');
  });
  it('linkGithub aceita só https://github.com/<dono>/<repo>[/...]', () => {
    expect(linkGithub('https://github.com/exemplo/repo/pull/7/files')).toBe('https://github.com/exemplo/repo/pull/7/files');
    for (const ruim of ['http://github.com/a/b', 'https://github.com/a', 'https://github.com/', 'https://github.com:444/a/b', 'https://gist.github.com/a/b', 'https://github.com/a/../../x', 'data:text/html,x', 'javascript:alert(1)', '//github.com/a/b']) {
      expect(linkGithub(ruim)).toBeUndefined();
    }
  });
});

const salasNaMistura = (st: EspiralStore) => (st.mistura as unknown as { salas: Map<string, unknown> }).salas.size;

describe('auditoria Sentinela (eixo 1): E1 perda de acesso, E2 corrida, E5 aba volta', () => {
  it('E1: 403 na sala limpa a mistura e o canvas na hora, fase sem-acesso', async () => {
    let negar = false;
    const base = api(['sala-a'], { 'sala-a': { presencas: [presenca(1002, 'bruno-teste', 'Loja nova')], itens: [item('aaaaaaaaaaaaaaaa')] } });
    const { busca } = falsa((url) => (negar && url.includes('/api/f/') ? { status: 403, corpo: { ok: false } } : base(url)));
    const store = new EspiralStore(busca, () => AGORA);
    await store.atualizar();
    expect(store.snapshot!.agents.length).toBeGreaterThan(0);
    negar = true;
    await store.atualizar();
    expect(store.estado.fase).toBe('sem-acesso');
    expect(store.estado.presencas).toEqual([]);
    expect(store.estado.itens).toEqual([]);
    expect(store.snapshot!.agents).toEqual([]);
    expect(store.snapshot!.rooms).toEqual([]);
    expect(salasNaMistura(store)).toBe(0);
  });

  it('E1: 401 e sem-salas também limpam a mistura e o canvas na hora', async () => {
    for (const tipo of ['401', 'sem-salas'] as const) {
      let estado: 'ok' | 'ruim' = 'ok';
      const base = api(['sala-a'], { 'sala-a': { presencas: [presenca(1002, 'bruno-teste', 'Loja nova')], itens: [] } });
      const { busca } = falsa((url) => (estado === 'ok' ? base(url) : tipo === '401' ? { status: 401, corpo: { ok: false } } : url.endsWith('/api/eu') ? { status: 200, corpo: eu([]) } : base(url)));
      const store = new EspiralStore(busca, () => AGORA);
      await store.atualizar();
      expect(store.snapshot!.agents.length).toBeGreaterThan(0);
      estado = 'ruim';
      await store.atualizar();
      expect(store.snapshot!.agents, tipo).toEqual([]);
      expect(store.snapshot!.rooms, tipo).toEqual([]);
      expect(salasNaMistura(store), tipo).toBe(0);
    }
  });

  it('E2: poll da sala A em voo não sobrescreve a escolha da sala B', async () => {
    let solta!: () => void;
    const porta = new Promise<void>((r) => (solta = r));
    let segurar = false;
    const base = api(['sala-a', 'sala-b'], {
      'sala-a': { presencas: [presenca(1002, 'bruno-teste', 'Loja A')], itens: [] },
      'sala-b': { presencas: [presenca(1003, 'carla-teste', 'Loja B')], itens: [] },
    });
    const busca = async (url: string, init?: RequestInit) => {
      if (segurar && url.includes('/sala-a/presenca')) await porta;
      const r = base(url);
      if (r === 'cai') throw new TypeError('x');
      return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    const store = new EspiralStore(busca, () => AGORA);
    await store.atualizar();
    segurar = true;
    const velha = store.atualizar(); // poll de sala-a fica preso
    await new Promise((r) => setTimeout(r, 5)); // o poll já leu a conta e está preso na presença de sala-a
    store.escolherSala('sala-b');
    const nova = store.atualizar();
    solta();
    await Promise.all([velha, nova]);
    expect(store.estado.sala).toBe('sala-b');
    expect(store.snapshot!.rooms.map((r) => r.name)).toEqual(['Sala do projeto · sala-b', 'carla-teste · Loja B']);
  });

  it('E2: resultado antigo que chega depois da escolha é descartado mesmo sem nova volta aguardada', async () => {
    let solta!: () => void;
    const porta = new Promise<void>((r) => (solta = r));
    let segurar = false;
    const base = api(['sala-a', 'sala-b'], { 'sala-a': { presencas: [], itens: [] }, 'sala-b': { presencas: [], itens: [] } });
    const busca = async (url: string) => {
      if (segurar && url.includes('/sala-a/presenca')) await porta;
      const r = base(url);
      if (r === 'cai') throw new TypeError('x');
      return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    const store = new EspiralStore(busca, () => AGORA);
    await store.atualizar();
    segurar = true;
    const velha = store.atualizar();
    await new Promise((r) => setTimeout(r, 5));
    store.escolherSala('sala-b');
    await new Promise((r) => setTimeout(r, 5)); // a volta nova termina antes da velha
    expect(store.estado.sala).toBe('sala-b');
    solta();
    await velha;
    expect(store.estado.sala).toBe('sala-b');
    expect(store.snapshot!.rooms.map((r) => r.name)).toEqual(['Sala do projeto · sala-b']);
  });

  it('E5: ao voltar para a aba visível atualiza na hora; escondida não; stop() solta o ouvinte', async () => {
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', doc);
    try {
      const { busca, pedidos } = falsa(api(['sala-a'], { 'sala-a': { presencas: [], itens: [] } }));
      const store = new EspiralStore(busca, () => AGORA);
      store.start(1_000_000);
      await new Promise((r) => setTimeout(r, 5));
      const n = pedidos.length;
      doc.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 5));
      expect(pedidos.length).toBe(n);
      doc.hidden = false;
      doc.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 5));
      expect(pedidos.length).toBeGreaterThan(n);
      store.stop();
      const m = pedidos.length;
      doc.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 5));
      expect(pedidos.length).toBe(m);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('E3: linkGithub só aceita subcaminhos de leitura; com o repo da sala, só esse repo', () => {
    expect(linkGithub('https://github.com/exemplo/repo/blob/main/a.md')).toBeDefined();
    for (const sub of ['blob', 'tree', 'commit', 'pull', 'issues', 'compare']) expect(linkGithub(`https://github.com/exemplo/repo/${sub}/x`)).toBeDefined();
    for (const ruim of ['https://github.com/exemplo/repo', 'https://github.com/exemplo/repo/', 'https://github.com/exemplo/repo/settings/keys', 'https://github.com/exemplo/repo/archive/x.zip', 'https://github.com/exemplo/repo/invitations']) {
      expect(linkGithub(ruim), ruim).toBeUndefined();
    }
    expect(linkGithub('https://github.com/Exemplo/Repo/pull/7', 'exemplo/repo')).toBe('https://github.com/Exemplo/Repo/pull/7');
    expect(linkGithub('https://github.com/outro/repo/pull/7', 'exemplo/repo')).toBeUndefined();
    expect(linkGithub('https://github.com/exemplo/outro/pull/7', 'exemplo/repo')).toBeUndefined();
  });
});

// ---------------------------------------------------------------- DOM falso mínimo (sem dependência nova)

class TextoFalso {
  constructor(public data: string) {}
}
class ElFalso {
  className = '';
  hidden = false;
  open = false;
  tabIndex = 0;
  href = '';
  target = '';
  rel = '';
  referrerPolicy = '';
  type = '';
  id = '';
  private _value = '';
  attrs: Record<string, string> = {};
  filhos: (ElFalso | TextoFalso)[] = [];
  constructor(public tag: string, private doc: DocFalso) {}
  set innerHTML(_v: string) {
    this.doc.innerHtmlTentativas++;
    throw new Error('innerHTML proibido');
  }
  get textContent(): string {
    return this.filhos.map((f) => (f instanceof TextoFalso ? f.data : f.textContent)).join('');
  }
  set textContent(v: string) {
    this.filhos = v ? [new TextoFalso(v)] : [];
  }
  get options(): ElFalso[] {
    return this.filhos.filter((f): f is ElFalso => f instanceof ElFalso && f.tag === 'option');
  }
  get value(): string {
    return this._value;
  }
  set value(v: string) {
    this._value = v;
  }
  append(...n: (ElFalso | TextoFalso | string)[]): void {
    for (const x of n) this.filhos.push(typeof x === 'string' ? new TextoFalso(x) : x);
  }
  replaceChildren(...n: (ElFalso | TextoFalso | string)[]): void {
    this.filhos = [];
    this.append(...n);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  addEventListener(): void {}
  scrollIntoView(): void {}
  focus(): void {}
}
class DocFalso {
  innerHtmlTentativas = 0;
  createElement(tag: string): ElFalso {
    return new ElFalso(tag, this);
  }
  createTextNode(t: string): TextoFalso {
    return new TextoFalso(t);
  }
}

const globalAntes = (globalThis as { document?: unknown }).document;
function instalarDomFalso(): DocFalso {
  const d = new DocFalso();
  (globalThis as { document?: unknown }).document = d;
  return d;
}
afterEach(() => {
  (globalThis as { document?: unknown }).document = globalAntes;
});

function coletar<T>(n: ElFalso | TextoFalso, f: (n: ElFalso | TextoFalso) => T | undefined, out: T[] = []): T[] {
  const v = f(n);
  if (v !== undefined) out.push(v);
  if (n instanceof ElFalso) for (const c of n.filhos) coletar(c, f, out);
  return out;
}
function achar(n: ElFalso | TextoFalso, f: (n: ElFalso | TextoFalso) => boolean): ElFalso | TextoFalso | undefined {
  if (f(n)) return n;
  if (n instanceof ElFalso) for (const c of n.filhos) {
    const r = achar(c, f);
    if (r) return r;
  }
  return undefined;
}
