// A1 da revisão: no modo de visualização nenhum segredo conhecido sai pela rede, em nenhuma rota de leitura
// (snapshot, stream, detalhe do agente, histórico de sessões e timeline), nem o que já estava gravado em disco.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { SessionHistory } from '../sources/history';
import { encodeCwd } from '../sources/watcher';
import { L, tempDir, writeLines } from '../test/fixtures';
import { createApiHandler, type ApiDeps } from './app';
import { createRequestGuard } from './guard';
import { Hub } from './sse';
import { createTimelineHandler } from './timeline';

setQuiet(true);

const GH = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
const SK = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';
const TAILNET = '100.81.240.92:4747';
const SID = '00000000-0000-4000-8000-0000000000a1';
const CWD = '/projetos/loja';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

interface Env {
  port: number;
  close: () => Promise<void>;
}

async function serve(view: boolean): Promise<Env> {
  const tmp = tempDir('habblaud-viewsec-');
  cleanups.push(tmp.cleanup);
  const dir = join(tmp.dir, '.claude');
  const now = Date.now();
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeLines(join(dir, 'projects', encodeCwd(CWD), `${SID}.jsonl`), [
    L.prompt(`Use o token ${GH} para o deploy`, { at: now - 60_000 }),
    L.raw('ai-title', { aiTitle: `Deploy com ${SK}` }),
  ]);
  const tl = join(tmp.dir, 'timeline');
  mkdirSync(tl, { recursive: true });
  const day = [
    JSON.stringify({ t: 'k', at: 1_000, v: 1, every: 300_000, boot: true, rooms: [], agents: [{ id: 'a', title: `T ${GH}` }], accounts: [] }),
    JSON.stringify({ t: 'end', at: 3_000 }),
  ].join('\n');
  writeFileSync(join(tl, '2026-10-07.jsonl'), `${day}\n`);

  const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => {} });
  const office = new Office({ names: new NameStore(null), version: 't', startedAt: now, accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
  // Campo que a fonte não mascarou (a rede de segurança tem de pegar): papel do agente com segredo.
  office.addMain({ id: '.claude:1', account: '.claude', sessionId: SID, cwd: CWD, role: `Agente com ${GH}`, startedAt: now, status: 'working' });
  const hub = new Hub(office, { throttleMs: 10, mask: view });
  hub.start();
  const deps: ApiDeps = {
    office,
    hub,
    accounts,
    sources: () => [],
    version: 't',
    inDocker: false,
    view,
    terminal: false,
    terminals: { attach: () => {}, attachSession: () => {} } as unknown as ApiDeps['terminals'],
    sessions: new SessionHistory({ accounts: () => accounts.entries(), openAgentOf: () => undefined }),
    timeline: createTimelineHandler({ dir: tl, recording: true }),
  };
  const api = createApiHandler(deps);
  const guard = createRequestGuard({ allowedHosts: new Set() });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((ok) => {
        hub.stop();
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers: { Host: TAILNET, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', fail);
    req.end();
  });
}

/** Lê o começo do /api/stream (snapshot + feed) e fecha. */
function streamHead(port: number): Promise<string> {
  return new Promise((ok, fail) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/stream', headers: { Host: TAILNET } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        text += c;
        if (text.includes('event: feed')) {
          req.destroy();
          ok(text);
        }
      });
      res.on('error', () => ok(text));
    });
    req.on('error', fail);
  });
}

const leaks = (s: string) => s.includes(GH) || s.includes(SK) || s.includes(GH.slice(0, 20)) || s.includes(SK.slice(0, 20));

describe('modo de visualização: nenhum segredo sai pela rede (A1)', () => {
  it('snapshot e detalhe do agente', async () => {
    const env = await serve(true);
    try {
      const snap = (await get(env.port, '/api/snapshot')).body.toString();
      expect(snap).toContain('Agente com');
      expect(leaks(snap)).toBe(false);
      const detail = await get(env.port, `/api/agents/${encodeURIComponent('.claude:1')}`);
      expect(detail.status).toBe(200);
      expect(leaks(detail.body.toString())).toBe(false);
    } finally {
      await env.close();
    }
  });

  it('stream (SSE)', async () => {
    const env = await serve(true);
    try {
      const text = await streamHead(env.port);
      expect(text).toContain('event: snapshot');
      expect(leaks(text)).toBe(false);
    } finally {
      await env.close();
    }
  });

  it('histórico de sessões: título e primeiro prompt mascarados', async () => {
    const env = await serve(true);
    try {
      const r = await get(env.port, '/api/sessions/recent');
      expect(r.status).toBe(200);
      const body = r.body.toString();
      expect(body).toContain('Deploy com');
      expect(leaks(body)).toBe(false);
    } finally {
      await env.close();
    }
  });

  it('timeline: o arquivo já gravado sai mascarado, com e sem gzip', async () => {
    const env = await serve(true);
    try {
      const plain = await get(env.port, '/api/timeline/2026-10-07');
      expect(plain.status).toBe(200);
      const text = plain.body.toString();
      expect(text.trim().split('\n').map((l) => JSON.parse(l).t)).toEqual(['k', 'end']);
      expect(leaks(text)).toBe(false);
      const gz = await get(env.port, '/api/timeline/2026-10-07', { 'Accept-Encoding': 'gzip' });
      expect(leaks(gunzipSync(gz.body).toString())).toBe(false);
    } finally {
      await env.close();
    }
  });
});

describe('fora do modo de visualização a saída continua igual', () => {
  it('snapshot e timeline não passam por maskDeep', async () => {
    const env = await serve(false);
    try {
      expect((await get(env.port, '/api/snapshot', { Host: 'localhost' })).body.toString()).toContain(GH);
      expect((await get(env.port, '/api/timeline/2026-10-07', { Host: 'localhost' })).body.toString()).toContain(GH);
    } finally {
      await env.close();
    }
  });
});
