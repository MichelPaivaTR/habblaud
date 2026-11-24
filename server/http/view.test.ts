// Modo de visualização pela tailnet (HABBLAUD_VIEW_REMOTE): leitura do terminal e do histórico liberada pelo Host da
// tailnet; toda escrita segue em 403 e nunca chega ao serviço. Os stubs de escrita provam que a rota não é chamada.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { SessionHistory } from '../sources/history';
import { tempDir } from '../test/fixtures';
import { createApiHandler, type ApiDeps } from './app';
import { createRequestGuard } from './guard';
import { Hub } from './sse';

setQuiet(true);

const TAILNET = '100.81.240.92:4747';
const cleanups: Array<() => void> = [];

interface Server {
  port: number;
  close: () => Promise<void>;
  cleanup: () => void;
}

async function serve(extra: Partial<ApiDeps>): Promise<Server> {
  const tmp = tempDir();
  const dir = join(tmp.dir, '.claude');
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  const late: { office?: Office } = {};
  const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => late.office?.markDirty() });
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: Date.now(),
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: () => undefined,
  });
  late.office = office;
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false, ...extra });
  const guard = createRequestGuard({ allowedHosts: new Set() });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    api(req, res, new URL(req.url ?? '/', 'http://x'));
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
    cleanup: tmp.cleanup,
  };
}

/** Requisição com um Host escolhido (fetch não deixa trocar o cabeçalho Host). */
function call(port: number, method: string, path: string, host = TAILNET): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { Host: host, 'Content-Type': 'application/json' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
        res.on('error', fail);
      },
    );
    req.on('error', fail);
    req.end(method === 'GET' ? undefined : '{}');
  });
}

/** Terminal e histórico de mentira: respondem como o real faria para um agente/sessão válidos. */
const streams = {
  attach: (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {}\n\n');
  },
  attachSession: (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {}\n\n');
  },
};

const writes = () => ({
  messages: vi.fn(),
  permissions: vi.fn(),
  pty: vi.fn(),
});

describe('modo de visualização (HABBLAUD_VIEW_REMOTE) pela tailnet', () => {
  let s: Server;
  let w: ReturnType<typeof writes>;
  beforeEach(async () => {
    w = writes();
    s = await serve({
      view: true,
      terminal: false,
      terminals: streams as unknown as ApiDeps['terminals'],
      sessions: new SessionHistory({ accounts: () => [], openAgentOf: () => undefined }),
      messages: w.messages as unknown as ApiDeps['messages'],
      permissions: w.permissions as unknown as ApiDeps['permissions'],
      pty: w.pty as unknown as ApiDeps['pty'],
    });
  });
  afterEach(async () => {
    await s.close();
    s.cleanup();
  });

  it('lê o terminal de um agente e o histórico pelo Host da tailnet', async () => {
    expect((await call(s.port, 'GET', '/api/agents/.claude:1/terminal')).status).toBe(200);
    expect((await call(s.port, 'GET', '/api/sessions/recent')).status).toBe(200);
  });

  it('o acesso diz só o que é verdade: terminal sim, escrita não', async () => {
    const access = JSON.parse((await call(s.port, 'GET', '/api/access')).body);
    expect(access).toMatchObject({ local: false, terminal: true, permissions: false, messages: false, spawn: false, world: false });
  });

  it('escrita pela tailnet segue em 403 e nunca chega ao serviço', async () => {
    for (const [method, path] of [
      ['POST', '/api/messages'],
      ['POST', '/api/permissions'],
      ['POST', '/api/pty/new'],
      ['POST', '/api/agents/.claude:1/stop'],
      ['POST', '/api/agents/.claude:1/takeover'],
      ['PUT', '/api/agents/.claude:1/character'],
      ['POST', '/api/rooms/rename'],
      ['GET', '/api/deliveries'],
      ['GET', '/api/deliveries/file/x'],
      ['POST', '/api/demo'],
      ['POST', '/api/updates/check'],
      ['POST', '/api/spawn'],
    ]) {
      expect((await call(s.port, method, path)).status, `${method} ${path}`).toBe(403);
    }
    expect(w.messages).not.toHaveBeenCalled();
    expect(w.permissions).not.toHaveBeenCalled();
    expect(w.pty).not.toHaveBeenCalled();
  });

  it('o World segue em 404', async () => {
    expect((await call(s.port, 'GET', '/api/world/status')).status).toBe(404);
  });

  it('histórico: conta desconhecida → 404 e id inválido (com ../) → 400, sem ler arquivo', async () => {
    expect((await call(s.port, 'GET', '/api/sessions/nao-existe/7b0f1c2e-1111-4222-8333-444455556666/terminal')).status).toBe(404);
    expect((await call(s.port, 'GET', '/api/sessions/.claude/..%2F..%2Fetc/terminal')).status).toBe(400);
  });
});

describe('histórico em modo de visualização: sessão real', () => {
  const SID = '7b0f1c2e-1111-4222-8333-444455556666';
  let s: Server;
  let dir: string;
  let attached: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    const tmp = tempDir();
    dir = join(tmp.dir, 'conta');
    mkdirSync(join(dir, 'projects', '-p-loja'), { recursive: true });
    writeFileSync(join(dir, 'projects', '-p-loja', `${SID}.jsonl`), '{"type":"user","message":{"role":"user","content":"oi"}}\n');
    attached = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {}\n\n');
    });
    s = await serve({
      view: true,
      terminal: false,
      terminals: { attach: streams.attach, attachSession: attached } as unknown as ApiDeps['terminals'],
      sessions: new SessionHistory({ accounts: () => [{ id: 'conta', dir }], openAgentOf: () => undefined }),
    });
    cleanups.push(tmp.cleanup);
  });
  afterEach(async () => {
    await s.close();
    cleanups.splice(0).forEach((c) => c());
  });

  it('abre a conversa de uma sessão encerrada, só com o transcript da conta', async () => {
    expect((await call(s.port, 'GET', `/api/sessions/conta/${SID}/terminal`)).status).toBe(200);
    expect(attached).toHaveBeenCalledTimes(1);
    expect(String(attached.mock.calls[0][3])).toContain(`${dir}/projects/-p-loja/${SID}.jsonl`);
  });

  it('a sessão que não existe na conta volta 404 sem abrir nada', async () => {
    expect((await call(s.port, 'GET', '/api/sessions/conta/00000000-0000-4000-8000-000000000000/terminal')).status).toBe(404);
    expect(attached).not.toHaveBeenCalled();
  });
});

describe('sem o modo de visualização, a tailnet segue barrada', () => {
  let s: Server;
  beforeEach(async () => {
    s = await serve({
      terminal: false,
      terminals: streams as unknown as ApiDeps['terminals'],
      sessions: new SessionHistory({ accounts: () => [], openAgentOf: () => undefined }),
    });
  });
  afterEach(async () => {
    await s.close();
    s.cleanup();
  });

  it('terminal e histórico respondem 403 pelo Host da tailnet', async () => {
    expect((await call(s.port, 'GET', '/api/agents/.claude:1/terminal')).status).toBe(403);
    expect((await call(s.port, 'GET', '/api/sessions/recent')).status).toBe(403);
    expect(JSON.parse((await call(s.port, 'GET', '/api/access')).body).terminal).toBe(false);
  });
});
