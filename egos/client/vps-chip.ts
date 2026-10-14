// Chip "VPS" na barra de uso: as contas espelhadas da VPS (id ".vps-*") ficam agrupadas num chip só, que abre ao
// clicar. Sem isso, 8 cartões não cabem na barra a 1440 px e passam por cima dos botões.
import type { AccountInfo } from '../../shared/types';

export const ehVps = (a: Pick<AccountInfo, 'id'>): boolean => /^\.?vps-/i.test(a.id);

/** Separa as contas da VPS; com o chip aberto, todas ficam visíveis. Puro. */
export function agruparVps<T extends Pick<AccountInfo, 'id'>>(accounts: readonly T[], aberto: boolean): { visiveis: T[]; vps: T[] } {
  const vps = accounts.filter(ehVps);
  if (vps.length < 2) return { visiveis: [...accounts], vps: [] };
  return { visiveis: aberto ? [...accounts] : accounts.filter((a) => !ehVps(a)), vps };
}

export class VpsChip {
  readonly el: HTMLButtonElement;
  aberto = false;

  constructor(onToggle: () => void) {
    this.el = document.createElement('button');
    this.el.type = 'button';
    this.el.className = 'egos-vps-chip';
    this.el.hidden = true;
    this.el.addEventListener('click', () => {
      this.aberto = !this.aberto;
      onToggle();
    });
  }

  render(vps: readonly Pick<AccountInfo, 'id' | 'name'>[], cards: HTMLElement): void {
    this.el.hidden = !vps.length;
    if (!vps.length) return;
    if (this.el.nextElementSibling !== cards) cards.before(this.el);
    const text = `🖥️ VPS · ${vps.length} ${this.aberto ? '▴' : '▾'}`;
    if (this.el.textContent !== text) this.el.textContent = text;
    this.el.title = `${this.aberto ? 'Fechar' : 'Abrir'} as ${vps.length} contas da VPS: ${vps.map((a) => a.name).join(', ')}`;
    this.el.setAttribute('aria-expanded', String(this.aberto));
  }
}
