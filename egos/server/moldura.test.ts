import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { cabecalhosDaMoldura, instalarMoldura, origensDoHq, permiteMoldura } from './moldura';

const req = (o: { method?: string; host?: string; dest?: string }): IncomingMessage =>
  ({ method: o.method ?? 'GET', headers: { host: o.host ?? '127.0.0.1:4747', ...(o.dest ? { 'sec-fetch-dest': o.dest } : {}) } }) as unknown as IncomingMessage;

describe('origens do HQ que podem enquadrar o Escritório', () => {
  it('padrão: só o painel local na 4700 (127.0.0.1 e localhost)', () => {
    expect(origensDoHq(undefined)).toEqual(['http://127.0.0.1:4700', 'http://localhost:4700']);
  });
  it('EGOS_HQ_ORIGENS aceita só origem http de loopback; o resto cai fora', () => {
    expect(origensDoHq('http://127.0.0.1:4701, https://evil.example, http://evil.example:4700, http://localhost:4701/x, *')).toEqual(['http://127.0.0.1:4701']);
    expect(origensDoHq('https://evil.example')).toEqual(['http://127.0.0.1:4700', 'http://localhost:4700']);
  });
});

describe('quando a página do Escritório pode ser enquadrada', () => {
  it('navegação de iframe, GET, Host local, fora de /api: sim', () => {
    expect(permiteMoldura(req({ dest: 'iframe' }), '/')).toBe(true);
    expect(permiteMoldura(req({ dest: 'iframe', host: 'localhost:4747' }), '/index.html')).toBe(true);
  });
  it('aba normal, script, API, POST, Host de fora ou sem Sec-Fetch-Dest: não', () => {
    expect(permiteMoldura(req({ dest: 'document' }), '/')).toBe(false);
    expect(permiteMoldura(req({}), '/')).toBe(false);
    expect(permiteMoldura(req({ dest: 'iframe' }), '/api/snapshot')).toBe(false);
    expect(permiteMoldura(req({ dest: 'iframe', method: 'POST' }), '/')).toBe(false);
    expect(permiteMoldura(req({ dest: 'iframe', host: 'evil.example' }), '/')).toBe(false);
    expect(permiteMoldura(req({ dest: 'iframe', host: '192.168.0.9:4747' }), '/')).toBe(false);
  });
});

describe('cabeçalhos', () => {
  const O = ['http://127.0.0.1:4700', 'http://localhost:4700'];
  it('troca X-Frame-Options DENY por frame-ancestors só do HQ local', () => {
    const h = cabecalhosDaMoldura({ 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-cache' }, O);
    expect(h['X-Frame-Options']).toBeUndefined();
    expect(h['Content-Security-Policy']).toBe('frame-ancestors http://127.0.0.1:4700 http://localhost:4700');
    expect(h['Cache-Control']).toBe('no-cache');
  });
  it('resposta que já traz CSP própria (ou não é DENY) fica como está', () => {
    const a = { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': 'sandbox' };
    expect(cabecalhosDaMoldura(a, O)).toBe(a);
    expect(cabecalhosDaMoldura({ 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'" }, O)['X-Frame-Options']).toBe('DENY');
  });
});

describe('servidor de verdade: o embrulho do writeHead', () => {
  let srv: http.Server;
  let porta = 0;
  let remoto = false;
  beforeAll(async () => {
    instalarMoldura(http.ServerResponse.prototype, ['http://127.0.0.1:4700'], () => remoto);
    instalarMoldura(http.ServerResponse.prototype, ['http://evil.example'], () => false); // segunda chamada não vale (idempotente)
    srv = http.createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY' }); res.end('ok'); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    porta = (srv.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));
  const get = (path: string, headers: Record<string, string>) =>
    new Promise<http.IncomingHttpHeaders>((ok, erro) => { http.get({ host: '127.0.0.1', port: porta, path, headers }, (res) => { res.resume(); ok(res.headers); }).on('error', erro); });

  it('iframe local: DENY some e entra frame-ancestors do HQ', async () => {
    remoto = false;
    const h = await get('/', { 'sec-fetch-dest': 'iframe' });
    expect(h['x-frame-options']).toBeUndefined();
    expect(h['content-security-policy']).toBe('frame-ancestors http://127.0.0.1:4700');
  });
  it('aba normal, API e acesso remoto continuam com DENY', async () => {
    remoto = false;
    expect((await get('/', { 'sec-fetch-dest': 'document' }))['x-frame-options']).toBe('DENY');
    expect((await get('/', {}))['x-frame-options']).toBe('DENY');
    expect((await get('/api/snapshot', { 'sec-fetch-dest': 'iframe' }))['x-frame-options']).toBe('DENY');
    remoto = true;
    expect((await get('/', { 'sec-fetch-dest': 'iframe' }))['x-frame-options']).toBe('DENY');
  });
});
