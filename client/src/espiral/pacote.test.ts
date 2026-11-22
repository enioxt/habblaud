/// <reference types="node" />
// ESPIRAL (visual web): varredura do pacote gerado (dist-espiral/) e do código-fonte novo.
// O pacote só existe depois de `npm run build:espiral`; com ESPIRAL_PACOTE=1 (o próprio build:espiral liga) a falta
// dele é FALHA. Sem a variável, a parte do pacote fica pulada e a do código-fonte roda sempre.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const DIST = join(RAIZ, 'dist-espiral');
const FONTE = fileURLToPath(new URL('./', import.meta.url));
const EXIGIR = process.env.ESPIRAL_PACOTE === '1';

/** O que não pode aparecer em nenhum arquivo de texto do pacote nem do código novo. */
const PROIBIDO: [string, RegExp][] = [
  ['127.0.0.1', /127\.0\.0\.1/],
  ['localhost', /localhost/i],
  ['porta 4747', /4747/],
  ['http:// ou https:// (qualquer endereço absoluto)', /https?:\/\//i],
  ['URL sem esquema //host', /["'`(]\/\/[a-z0-9-]+\.[a-z]/i],
  ['WebSocket', /WebSocket/],
  ['EventSource', /EventSource/],
  ['sendBeacon', /sendBeacon/],
  ['innerHTML', /innerHTML/],
  ['outerHTML', /outerHTML/],
  ['insertAdjacentHTML', /insertAdjacentHTML/],
  ['document.write', /document\.write/],
  ['eval', /\beval\s*\(/],
  ['new Function', /new\s+Function\b/],
  ['setTimeout com texto', /set(?:Timeout|Interval)\(\s*["'`]/],
];

/** Nomes que identificam salas ou repositórios reservados: o código do visual é igual para todos e não leva nenhum. */
const NOMES_RESERVADOS = [/projeto-001/i, /kb-amaral/i, /base-conhecimento/i];

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

const ehTexto = (p: string) => /\.(js|css|html|txt)$/.test(p);

function varrer(p: string, texto: string): string[] {
  const achados: string[] = [];
  for (const [nome, re] of PROIBIDO) if (re.test(texto)) achados.push(`${relative(RAIZ, p)}: ${nome}`);
  for (const re of NOMES_RESERVADOS) if (re.test(texto)) achados.push(`${relative(RAIZ, p)}: nome reservado ${re}`);
  return achados;
}

describe('código-fonte novo (client/src/espiral, menos testes)', () => {
  it('sem innerHTML, eval, endereço absoluto, porta local ou nome reservado', () => {
    const fontes = readdirSync(FONTE).filter((n) => /\.(ts|css)$/.test(n) && !n.endsWith('.test.ts')).map((n) => join(FONTE, n));
    fontes.push(join(RAIZ, 'client/espiral.html'));
    expect(fontes.length).toBeGreaterThanOrEqual(7);
    const achados = fontes.flatMap((p) => varrer(p, readFileSync(p, 'utf8')));
    expect(achados).toEqual([]);
  });
});

describe.skipIf(!EXIGIR && !existsSync(DIST))('pacote gerado (dist-espiral)', () => {
  it('existe', () => {
    expect(existsSync(join(DIST, 'espiral.html')), 'rode npm run build:espiral').toBe(true);
  });

  const lista = existsSync(DIST) ? arquivos(DIST) : [];

  it('nenhum texto proibido em JS, CSS, HTML e TXT (o aviso de licença e a proveniência incluídos)', () => {
    const achados = lista.filter(ehTexto).flatMap((p) => varrer(p, readFileSync(p, 'utf8')));
    expect(achados).toEqual([]);
  });

  it('só HTML, TXT, JS, CSS e PNG; o gerado vai em bundle/ com nome por hash', () => {
    for (const p of lista) {
      const r = relative(DIST, p);
      if (['espiral.html', 'LICENSE.txt', 'PROVENIENCIA.txt'].includes(r)) continue;
      expect(r).toMatch(/^bundle\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(js|css|png)$/);
    }
  });

  it('HTML: sem script ou estilo em linha; script e folha de estilo só por caminho relativo do pacote', () => {
    const html = readFileSync(join(DIST, 'espiral.html'), 'utf8');
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(m[1]).toMatch(/\bsrc="\.\/bundle\/[^"]+\.js"/);
      expect(m[2].trim()).toBe('');
    }
    for (const m of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) expect(m[1]).toMatch(/^\.\/bundle\/[A-Za-z0-9_.-]+$/);
  });

  it('aviso MIT no topo do JS e LICENSE.txt igual ao LICENSE do fork', () => {
    const licenca = readFileSync(join(RAIZ, 'LICENSE'), 'utf8');
    expect(readFileSync(join(DIST, 'LICENSE.txt'), 'utf8')).toBe(licenca);
    const js = lista.filter((p) => p.endsWith('.js'));
    expect(js.length).toBeGreaterThanOrEqual(1);
    for (const p of js) {
      const t = readFileSync(p, 'utf8');
      expect(t.startsWith('/*!')).toBe(true);
      const topo = t.slice(0, 2000);
      expect(topo).toContain('Copyright (c) 2026 Márcio Junior');
      expect(topo).toContain('Permission is hereby granted, free of charge');
      expect(topo).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    }
  });

  it('PROVENIENCIA.txt confere: commit e sha256 de cada arquivo', () => {
    const prov = readFileSync(join(DIST, 'PROVENIENCIA.txt'), 'utf8');
    expect(prov).toMatch(/^commit do fork: [0-9a-f]{40}$/m);
    expect(prov).toMatch(/^comando: /m);
    const linhas = [...prov.matchAll(/^([0-9a-f]{64}) {2}(\d+) {2}(.+)$/gm)];
    const esperados = lista.map((p) => relative(DIST, p)).filter((r) => r !== 'PROVENIENCIA.txt').sort();
    expect(linhas.map((l) => l[3]).sort()).toEqual(esperados);
    for (const [, sha, tam, r] of linhas) {
      const b = readFileSync(join(DIST, r));
      expect(createHash('sha256').update(b).digest('hex'), r).toBe(sha);
      expect(b.length).toBe(Number(tam));
    }
  });
});
