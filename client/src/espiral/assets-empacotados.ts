// ESPIRAL (visual web): substitui client/src/world/assets.ts SÓ no pacote da espiral (vite.espiral.config.ts troca o
// import './assets' de world/index.ts por este arquivo). O original busca /assets/manifest.json na raiz do site, o
// que na espiral seria um pedido fora de /espiralcoletiva. Aqui as pinturas e a placa entram no pacote, com nome por
// hash, e as imagens são carregadas pelo endereço relativo que o gerador escreve: nenhum fetch, nenhum manifesto.
import type { BrandAsset, WallArtAsset, WorldAssets } from '../world/assets';
import manifesto from '../../public/assets/manifest.json';
import placa from '../../public/assets/brand/signage.png?url';
import marca from '../../public/assets/brand/logo-mark.png?url';

export type { BrandAsset, WallArtAsset, WorldAssets } from '../world/assets';

const ARTE = import.meta.glob('../../public/assets/art/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlDe = (file: unknown): string | undefined => (typeof file === 'string' ? ARTE[`../../public/assets/${file}`] : undefined);

function carregar(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

interface Quadro {
  id: string;
  kind: string;
  file: string;
  tiles?: number;
  variant?: string;
  framed?: { file: string };
}

export async function loadWorldAssets(signal?: AbortSignal): Promise<WorldAssets | null> {
  try {
    const lista = ((manifesto as { wallArt?: Quadro[] }).wallArt ?? []).filter((a) => a.kind === 'painting' || a.kind === 'poster');
    const imgs = await Promise.all(lista.map((a) => carregar(urlDe(a.file))));
    const molduras = await Promise.all(lista.map((a) => carregar(urlDe(a.framed?.file))));
    if (signal?.aborted) return null;
    const wallArt: WallArtAsset[] = [];
    lista.forEach((a, i) => {
      const img = imgs[i];
      if (!img) return;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const tiles = typeof a.tiles === 'number' && a.tiles > 0 ? a.tiles : a.kind === 'poster' ? 1 : w > 40 ? 4 : 2;
      const f = molduras[i];
      wallArt.push({
        id: String(a.id),
        kind: a.kind as 'painting' | 'poster',
        img,
        w,
        h,
        tiles,
        variant: typeof a.variant === 'string' ? a.variant : undefined,
        framed: f ? { img: f, w: f.naturalWidth, h: f.naturalHeight } : undefined,
      });
    });
    const marcaDe = async (url: string): Promise<BrandAsset | undefined> => {
      const img = await carregar(url);
      return img ? { img, w: img.naturalWidth, h: img.naturalHeight } : undefined;
    };
    const [signage, mark] = await Promise.all([marcaDe(placa), marcaDe(marca)]);
    if (!wallArt.length && !signage && !mark) return null;
    return { wallArt, signage, mark };
  } catch {
    return null;
  }
}
