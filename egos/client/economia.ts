// Fork EGOS: ligado antes de o mundo nascer (importado no topo de client/src/main.ts).
// - economia por recibo: moeda só nasce de recibo de entrega verificado (wallet.ts);
// - modo real (EGOS_MODO_REAL): nada de ficção no escritório (rodas, falas, bordões, amizades, demo).
import { economia } from '../../client/src/world/social/wallet';
import { modoReal } from './modo-real';

economia.porRecibo = true;
modoReal.ligado = true;
