#!/usr/bin/env bun
// Verifica recibos sem internet: resumo, assinatura Ed25519, id da chave, pontos e estado recalculados.
//
//   bun egos/recibo/verificar.ts [arquivo.json | pasta]  [--chave ~/.habblaud/chave-recibo.pub]
//
// Sem argumento: ~/.egos/recibos. Com --chave (PEM ou base64 da chave crua), só aceita recibos dessa chave.
// Sai 0 se todos valem, 1 se algum falhou.
import { createPublicKey } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pubBase64, verificarRecibo } from './recibo';

export function lerChavePublica(texto: string): string {
  const t = texto.trim();
  return t.startsWith('-----BEGIN') ? pubBase64(createPublicKey(t)) : t;
}

export function arquivosDeRecibo(alvo: string): string[] {
  if (!existsSync(alvo)) return [];
  if (statSync(alvo).isFile()) return [alvo];
  return readdirSync(alvo)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => join(alvo, n));
}

function main(argv: string[]): number {
  const i = argv.indexOf('--chave');
  const chaveArq = i >= 0 ? argv[i + 1] : undefined;
  const posicionais = argv.filter((a, k) => !a.startsWith('--') && !(i >= 0 && k === i + 1));
  const alvo = (posicionais[0] ?? join(homedir(), '.egos', 'recibos')).replace(/^~(?=\/|$)/, homedir());
  const confiaveis = chaveArq ? [lerChavePublica(readFileSync(chaveArq.replace(/^~(?=\/|$)/, homedir()), 'utf8'))] : [];
  const files = arquivosDeRecibo(alvo);
  if (!files.length) {
    console.error(`nenhum recibo em ${alvo}`);
    return 1;
  }
  let ruins = 0;
  for (const f of files) {
    let dado: unknown;
    try {
      dado = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      dado = undefined;
    }
    const r = verificarRecibo(dado, confiaveis);
    if (r.ok) console.log(`VÁLIDO   ${r.recibo.hash} · ${r.recibo.oque.commit.slice(0, 9)} · ${r.recibo.estado} · ${r.recibo.pontos} pts · chave ${r.recibo.chave.id}${confiaveis.length ? '' : ' (sem lista de confiança)'}`);
    else {
      ruins++;
      console.log(`INVÁLIDO ${f}: ${r.motivo}`);
    }
  }
  return ruins ? 1 : 0;
}

if (process.argv[1]?.endsWith('verificar.ts')) process.exit(main(process.argv.slice(2)));
