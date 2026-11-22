// ESPIRAL (visual web): o mundo do Habblaud montado para a espiral, com as carteiras SÓ em memória.
// A página roda na mesma origem do site: o que o mundo gravasse no localStorage (número da conta, nome da sala e apelido
// de cada agente) ficaria no aparelho depois do logout ou da revogação e seria legível por outra página da mesma origem.
// mundo.test.ts reprova qualquer leitura ou escrita no armazenamento do navegador.
import { modoReal } from '../../../egos/client/modo-real';
import { createWorld, type WorldStore } from '../world';

/**
 * Modo real ligado: só agentes que vieram da API aparecem; nenhuma roda social inventada (jogos, apostas de moedinhas,
 * falas e bordões do Habblaud). Sem isso, agente parado entraria em brincadeira fictícia na tela de uma equipe real.
 */
export const criarMundoEspiral = (canvas: HTMLCanvasElement, store: WorldStore) => {
  modoReal.ligado = true;
  return createWorld(canvas, store, { storage: null });
};
