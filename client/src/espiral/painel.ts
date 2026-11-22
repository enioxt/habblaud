// ESPIRAL (visual web): painel lateral. Regra de segurança: todo texto entra por textContent ou nó de texto (nunca
// HTML montado com texto de fora; a varredura em pacote.test.ts barra as APIs de HTML); o único href vindo de dado é o "abrir no GitHub", que
// já passou por linkGithub (esquema.ts) e abre em aba nova sem referrer e sem acesso de volta à página.
import type { Selection, WorldApi } from '../world/api';
import { haQuanto, idSala, idSalaProjeto } from './converter';
import type { ItemMural, Presenca } from './esquema';
import { BASE, type EspiralStore } from './store';

type Filhos = (Node | string | null | undefined | false)[];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string, ...filhos: Filhos): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  for (const f of filhos) {
    if (f === null || f === undefined || f === false) continue;
    e.append(typeof f === 'string' ? document.createTextNode(f) : f);
  }
  return e;
}

function link(texto: string, href: string, fora = false): HTMLAnchorElement {
  const a = el('a', fora ? 'fora' : undefined, texto);
  a.href = href;
  if (fora) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.referrerPolicy = 'no-referrer';
  }
  return a;
}

function botao(texto: string, acao: () => void): HTMLButtonElement {
  const b = el('button', undefined, texto);
  b.type = 'button';
  b.addEventListener('click', acao);
  return b;
}

const PAPEL: Record<string, string> = { principal: 'principal', explorador: 'explorador', planejador: 'planejador', ajudante: 'ajudante' };
const ESTADO: Record<string, string> = { trabalhando: 'trabalhando', parado: 'parado', 'esperando voce': 'esperando você', saiu: 'saiu' };
const data = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/');

export function montarPainel(raiz: HTMLElement, store: EspiralStore, world: WorldApi): void {
  const aberto = new Set<string>();
  let selecao: Selection = null;

  const titulo = el('h1', undefined, 'Espiral coletiva');
  const conta = el('p', 'conta');
  const seletor = el('select');
  seletor.setAttribute('aria-label', 'Projeto');
  seletor.addEventListener('change', () => {
    world.select(null);
    store.escolherSala(seletor.value);
  });
  const rotuloSeletor = el('label', 'seletor', 'Projeto ', seletor);
  const aviso = el('p', 'aviso');
  aviso.setAttribute('role', 'status');
  const corpo = el('div', 'corpo');
  const rodape = el('footer', undefined, 'Visual baseado no Habblaud (MIT) · ', link('licença', './LICENSE.txt'), ' · ', link('ver em lista', `${BASE}/`));
  raiz.replaceChildren(el('header', undefined, titulo, conta, rotuloSeletor), aviso, corpo, rodape);

  const foco = el('section', 'foco');
  const quem = el('section', 'quem');
  const mural = el('section', 'mural');
  mural.id = 'mural';
  mural.tabIndex = -1;

  function desenharFoco(rolar = false): void {
    const agora = Date.now();
    if (!selecao) return void foco.replaceChildren();
    const sala = store.estado.sala;
    if (selecao.type === 'room' && sala && selecao.id === idSalaProjeto(sala)) {
      foco.replaceChildren(el('h2', undefined, `Sala do projeto · ${sala}`), el('p', undefined, `${store.estado.itens.length} itens no mural, ${store.estado.presencas.length} presenças publicadas.`));
      if (rolar) {
        mural.scrollIntoView({ block: 'start', behavior: 'smooth' });
        mural.focus({ preventScroll: true });
      }
      return;
    }
    const achado = store.mistura.doId(selecao.id);
    if (!achado) return void foco.replaceChildren();
    const { p, i } = achado;
    if (i === undefined) {
      foco.replaceChildren(el('h2', undefined, `${p.dono.login} · ${p.sala}`), el('p', undefined, `${p.agentes.length} de ${p.total} agentes à vista · ${haQuanto(p.em, agora)}`));
      return;
    }
    const a = p.agentes[i];
    const linhas = el('dl', undefined,
      el('dt', undefined, 'papel'), el('dd', undefined, PAPEL[a.papel] ?? a.papel),
      el('dt', undefined, 'estado'), el('dd', undefined, ESTADO[a.estado] ?? a.estado),
      a.atividade ? el('dt', undefined, 'atividade') : null, a.atividade ? el('dd', undefined, a.atividade) : null,
      el('dt', undefined, 'de'), el('dd', undefined, `@${p.dono.login} · ${p.sala}`),
      el('dt', undefined, 'publicado'), el('dd', undefined, haQuanto(p.em, agora)),
    );
    foco.replaceChildren(el('h2', undefined, a.apelido), linhas);
  }

  function desenharQuem(presencas: Presenca[]): void {
    const agora = Date.now();
    const lista = el('ul');
    for (const p of presencas) {
      const ativos = p.agentes.filter((a) => a.estado === 'trabalhando').length;
      const li = el('li', undefined, el('strong', undefined, `@${p.dono.login}`), ` · ${p.sala}`, el('span', 'meta', `${p.agentes.length} agentes, ${ativos} trabalhando · ${haQuanto(p.em, agora)}`));
      li.tabIndex = 0;
      const ir = () => world.select({ type: 'room', id: idSala(p) }, { focus: true });
      li.addEventListener('click', ir);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ir();
        }
      });
      lista.append(li);
    }
    quem.replaceChildren(el('h2', undefined, `Quem está (${presencas.length})`), presencas.length ? lista : el('p', 'vazio', 'Ninguém publicou presença nesta espiral agora.'));
  }

  function desenharMural(itens: ItemMural[]): void {
    const lista = el('ul');
    for (const it of itens) {
      const texto = it.texto ? el('details', undefined, el('summary', undefined, 'ver texto'), el('p', 'texto', it.texto)) : null;
      if (texto) {
        texto.open = aberto.has(it.id);
        texto.addEventListener('toggle', () => (texto.open ? aberto.add(it.id) : aberto.delete(it.id)));
      }
      lista.append(
        el('li', undefined,
          el('span', 'tipo', it.estado ? `${it.tipo} · ${it.estado}` : it.tipo),
          el('strong', undefined, it.titulo),
          el('span', 'meta', `@${it.autor} · ${data(it.atualizado)}`),
          texto,
          it.fonte ? link('abrir no GitHub', it.fonte, true) : null,
        ),
      );
    }
    mural.replaceChildren(el('h2', undefined, `Mural (${itens.length})`), itens.length ? lista : el('p', 'vazio', 'Nenhum item no mural desta espiral.'));
  }

  function desenhar(): void {
    const e = store.estado;
    aviso.textContent = e.aviso ?? '';
    aviso.hidden = !e.aviso;
    conta.textContent = e.eu ? `Conta conectada: @${e.eu.conta.login}` : '';
    const salas = e.eu?.salas ?? [];
    rotuloSeletor.hidden = salas.length < 2;
    if (seletor.options.length !== salas.length || salas.some((s, i) => seletor.options[i]?.value !== s)) {
      seletor.replaceChildren(...salas.map((s) => {
        const o = el('option', undefined, s);
        o.value = s;
        return o;
      }));
    }
    if (e.sala) seletor.value = e.sala;

    if (e.fase === 'carregando') return void corpo.replaceChildren(el('p', undefined, 'Carregando…'));
    if (e.fase === 'fora') return void corpo.replaceChildren(el('p', undefined, 'Para entrar, conecte a sua conta do GitHub.'), link('Entrar com GitHub', `${BASE}/`));
    if (e.fase === 'erro') return void corpo.replaceChildren(botao('Tentar de novo', () => void store.atualizar()));
    if (e.fase === 'sem-acesso') {
      selecao = null;
      return void corpo.replaceChildren(
        el('p', undefined, 'Seu acesso a este projeto mudou. Os dados dele saíram da tela.'),
        botao('Conferir de novo', () => void store.atualizar()),
      );
    }
    if (e.fase === 'sem-salas') {
      return void corpo.replaceChildren(
        el('p', undefined, 'Você ainda não participa de nenhuma espiral de escuta.'),
        el('p', undefined, 'O acesso vem de dois passos: ser colaborador do repositório do projeto no GitHub e ter o acordo do projeto registrado. Se recebeu convite do GitHub, aceite pelo e-mail da sua conta ou pelas notificações do GitHub.'),
        botao('Conferir de novo', () => void store.atualizar()),
      );
    }
    desenharQuem(e.presencas);
    desenharMural(e.itens);
    desenharFoco();
    corpo.replaceChildren(foco, quem, mural);
  }

  world.onSelect((s) => {
    selecao = s;
    desenharFoco(true);
  });
  store.on('estado', desenhar);
  desenhar();
}
