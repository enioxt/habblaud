// Interface da camada EGOS: seção "Recibos de entrega" na gaveta do agente, botão e janela do Placar (clãs por
// projeto + contas que ligaram o placar) e o grupo "Placar" nas Configurações (opt-in por conta, desligado por padrão).
// O visual reaproveita as classes do Habblaud (ui-sec, ui-popover, ui-set, ui-switch); o CSS próprio é pouco e fica aqui.
import type { AgentInfo } from '../../shared/types';
import type { UiComponent, UiContext } from '../../client/src/ui/context';
import { h, iconButton, setAttr, setHidden, setText } from '../../client/src/ui/dom';
import { ICONS } from '../../client/src/ui/icons';
import { PROVA_ROTULO, recibos, recibosDoAgente, type ReciboVisto } from './estado';

const TROPHY =
  '<svg class="ui-px-icon" width="20" height="20" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M2 1h6v1h2v2H9v1H8v1H7v1H6v1h1v1H3V8h1V7H3V6H2V5H1V4H0V2h2zM1 3v1h1V3zm7 0v1h1V3z"/></svg>';

const CSS = `
.egos-recibo{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.egos-recibo li{border:1px solid var(--ui-line);border-radius:8px;padding:6px 8px;background:rgba(255,255,255,.02)}
.egos-recibo__top{display:flex;gap:8px;align-items:baseline;justify-content:space-between}
.egos-recibo__pts{font:700 13px/1.2 var(--font-ui);color:#f4c542;white-space:nowrap}
.egos-recibo__est{font:500 11px/1 var(--font-px);padding:2px 5px;border-radius:5px;background:var(--ui-line);white-space:nowrap}
.egos-recibo__est.is-aceito{background:#1f6f43;color:#e8fff1}.egos-recibo__est.is-invalido{background:#7a2330;color:#fff}
.egos-recibo__tit{font-size:12px;color:var(--ui-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:3px 0}
.egos-recibo__provas{display:flex;flex-wrap:wrap;gap:4px}
.egos-recibo__prova{font-size:11px;padding:1px 5px;border-radius:5px;border:1px solid var(--ui-line)}
.egos-recibo details{margin-top:4px;font-size:11px;color:var(--ui-muted)}
.egos-recibo pre{white-space:pre-wrap;word-break:break-all;font:11px/1.35 ui-monospace,monospace;margin:4px 0 0}
.egos-placar{width:360px}
.egos-placar ol{margin:4px 0 0;padding:0;list-style:none}
.egos-placar li{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--ui-line)}
.egos-placar li b{color:#f4c542}
.egos-placar__nota{font-size:11.5px;color:var(--ui-muted);margin:4px 0 0}
`;

function injectCss(): void {
  if (typeof document.getElementById !== 'function' || document.getElementById('egos-css')) return;
  document.head.append(h('style', { attrs: { id: 'egos-css' }, text: CSS }));
}

function estadoClasse(r: ReciboVisto): string {
  return r.estado === 'ACEITO' ? 'is-aceito' : r.estado === 'INVÁLIDO' ? 'is-invalido' : '';
}

function itemRecibo(r: ReciboVisto): HTMLElement {
  const provas = r.provas.map((p) => h('span', { class: 'egos-recibo__prova', title: `${p.nivel} · ${p.ref ?? ''}`, text: PROVA_ROTULO[p.tipo] ?? p.tipo }));
  const detalhe = [
    `recibo  ${r.hash}`,
    `commit  ${r.commit}${r.pr ? `  (PR #${r.pr})` : ''}`,
    `projeto ${r.projeto}`,
    `chave   ${r.chave ?? '?'}${r.valido ? '  · assinatura confere' : `  · ${r.motivo ?? 'inválido'}`}`,
    ...r.provas.map((p) => `prova   ${p.tipo} (${p.nivel}) ${p.ref ?? ''}\n        ${p.digest}`),
    `verificar sem internet: bun egos/recibo/verificar.ts ~/.egos/recibos/${r.commit.slice(0, 12)}.json`,
  ].join('\n');
  return h(
    'li',
    {},
    h(
      'div',
      { class: 'egos-recibo__top' },
      h('span', { class: 'egos-recibo__pts', text: `🧾 +🪙${r.pontos}` }),
      h('span', { class: `egos-recibo__est ${estadoClasse(r)}`, text: r.estado }),
    ),
    h('div', { class: 'egos-recibo__tit', title: r.titulo, text: `${r.commit.slice(0, 7)} · ${r.titulo}` }),
    h('div', { class: 'egos-recibo__provas' }, ...provas),
    h('details', {}, h('summary', { text: 'Ver a prova' }), h('pre', { text: detalhe })),
  );
}

/** Seção da gaveta do agente: os recibos da sessão dele. */
export class RecibosSection {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private extra: HTMLElement;
  private key = '';

  constructor() {
    this.extra = h('span', { class: 'ui-sec__extra' });
    this.list = h('ol', { class: 'egos-recibo' });
    this.el = h(
      'section',
      { class: 'ui-sec egos-recibos' },
      h('div', { class: 'ui-sec__head' }, h('h3', { class: 'ui-sec__title', text: 'Recibos de entrega' }), this.extra),
      this.list,
    );
    setHidden(this.el, true);
  }

  render(a: AgentInfo | undefined): void {
    const list = a ? recibosDoAgente(recibos.dados, a) : [];
    setHidden(this.el, !list.length);
    const key = list.map((r) => `${r.hash}:${r.valido}`).join('|');
    if (key === this.key) return;
    this.key = key;
    setText(this.extra, `${list.filter((r) => r.valido).reduce((s, r) => s + r.pontos, 0)} pts`);
    this.list.replaceChildren(...list.slice(0, 8).map(itemRecibo));
  }
}

/** Janela do Placar: clãs (sala/projeto) e contas com opt-in. */
class PlacarPanel {
  readonly el: HTMLElement;
  private clas: HTMLElement;
  private contas: HTMLElement;
  private nota: HTMLElement;

  constructor() {
    const close = iconButton(ICONS.close, 'Fechar placar', () => this.hide(), 'ui-icon-btn--sm');
    this.clas = h('ol');
    this.contas = h('ol');
    this.nota = h('p', { class: 'egos-placar__nota' });
    this.el = h(
      'div',
      { class: 'ui-popover egos-placar', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': 'Placar de recibos', popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: '🏆 Placar de recibos' }), close),
      h('div', { class: 'ui-set-group' }, h('h3', { text: 'Clãs (sala / projeto)' }), this.clas),
      h('div', { class: 'ui-set-group' }, h('h3', { text: 'Contas no placar' }), this.contas, this.nota),
      h(
        'div',
        { class: 'ui-set-group' },
        h('p', { class: 'egos-placar__nota', text: 'Ponto só nasce de recibo de entrega provada (teste vermelho→verde, prova visual, decisão sua, PR com CI verde). Tempo, tokens, mensagens e login valem zero.' }),
      ),
    );
  }

  get isOpen(): boolean {
    return typeof this.el.matches === 'function' && this.el.matches(':popover-open');
  }

  toggle(anchor: HTMLElement): void {
    if (this.isOpen) return this.hide();
    this.render();
    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${Math.round(r.bottom + 8)}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
    this.el.style.left = 'auto';
    this.el.showPopover?.();
    void recibos.refresh().then(() => this.render());
  }

  hide(): void {
    if (this.isOpen) this.el.hidePopover?.();
  }

  render(): void {
    const d = recibos.dados;
    const linha = (l: { nome: string; pontos: number; recibos: number }, i: number) =>
      h('li', {}, h('span', { text: `${i + 1}. ${l.nome}` }), h('span', {}, h('b', { text: `${l.pontos} pts` }), h('span', { text: ` · ${l.recibos} recibo${l.recibos === 1 ? '' : 's'}` })));
    this.clas.replaceChildren(...(d?.clas ?? []).map(linha));
    if (!d?.clas.length) this.clas.replaceChildren(h('li', { text: d?.ligado ? 'Nenhum recibo ainda.' : 'Pasta de recibos não montada (rode o docker:up do fork).' }));
    this.contas.replaceChildren(...(d?.contas ?? []).map(linha));
    setText(this.nota, d?.contas.length ? 'Só aparecem as contas que ligaram o placar.' : 'Nenhuma conta ligou o placar. Ligue em Configurações › Placar (desligado por padrão).');
  }
}

/** Grupo "Placar" nas Configurações: um interruptor por conta. */
class PlacarSettings {
  readonly el: HTMLElement;
  private rows: HTMLElement;
  private key = '';

  constructor(private ctx: UiContext) {
    this.rows = h('div');
    this.el = h(
      'div',
      { class: 'ui-set-group egos-placar-set' },
      h('h3', { text: 'Placar de recibos' }),
      h('p', { class: 'ui-set__hint', text: 'Opt-in por conta: só a conta ligada aparece no placar. Clãs (sala/projeto) sempre contam.' }),
      this.rows,
    );
  }

  render(): void {
    const accounts = this.ctx.store.snapshot?.accounts ?? [];
    const placar = recibos.dados?.placar ?? {};
    const key = accounts.map((a) => `${a.id}:${a.name}:${!!placar[a.id]}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.rows.replaceChildren(
      ...accounts.map((a) => {
        const on = !!placar[a.id];
        const id = `egos-pl-${a.id.replace(/\W+/g, '-')}`;
        const btn = h('button', { class: 'ui-switch', type: 'button', role: 'switch', attrs: { 'aria-labelledby': id } }, h('span', { class: 'ui-switch__knob' }));
        setAttr(btn, 'aria-checked', String(on));
        btn.addEventListener('click', () => void recibos.setPlacar(a.id, !on).then(() => this.render()));
        return h('div', { class: 'ui-set' }, h('div', { class: 'ui-set__text' }, h('span', { class: 'ui-set__label', text: a.name, attrs: { id } })), btn);
      }),
    );
  }
}

/** Monta a camada: botão do placar na barra, janela, grupo nas Configurações e o pagamento das carteiras. */
export function montarEgos(ctx: UiContext, opts: { mount: (el: HTMLElement) => void; addButton: (b: HTMLElement) => void; settingsEl: HTMLElement }): UiComponent {
  injectCss();
  const panel = new PlacarPanel();
  const button = iconButton(TROPHY, 'Placar de recibos', () => panel.toggle(button));
  button.setAttribute('aria-haspopup', 'dialog');
  opts.addButton(button);
  opts.mount(panel.el);
  const settings = new PlacarSettings(ctx);
  // Antes do "Sobre" (último grupo das Configurações).
  if (typeof opts.settingsEl?.insertBefore === 'function') opts.settingsEl.insertBefore(settings.el, opts.settingsEl.lastElementChild);
  recibos.on(() => ctx.invalidate());
  // Só no navegador de verdade (nos testes do Habblaud o fetch é roteirizado e não pode ser consumido aqui).
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) recibos.start();
  return {
    render() {
      recibos.pay(ctx.world, ctx.store.snapshot);
      settings.render();
      if (panel.isOpen) panel.render();
    },
  };
}
