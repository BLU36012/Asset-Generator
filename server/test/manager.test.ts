import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LIBRARY } from '../src/generators/llm/library';
import { ManagedOllama } from '../src/generators/llm/manager';

/** A fake Ollama: the model "downloads" via a streamed pull, then chat requests take `chatMs`. */
async function fakeOllama(opts: { chatMs?: number } = {}) {
  let pulled = false;
  let chats = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      if (req.url === '/api/tags') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ models: pulled ? [{ name: 'tiny:1b' }] : [] }));
      }
      if (req.url === '/api/pull') {
        res.setHeader('Content-Type', 'application/x-ndjson');
        for (const completed of [0, 50, 100]) {
          res.write(JSON.stringify({ status: 'downloading', digest: 'sha256:a', total: 100, completed }) + '\n');
          await new Promise((r) => setTimeout(r, 20));
        }
        pulled = true;
        return res.end(JSON.stringify({ status: 'success' }) + '\n');
      }
      if (req.url === '/api/generate') return res.end('{}');
      if (req.url === '/api/chat') {
        chats++;
        await new Promise((r) => setTimeout(r, opts.chatMs ?? 0));
        return res.end(JSON.stringify({ message: { content: JSON.stringify(LIBRARY[0].design) } }));
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, chats: () => chats };
}

describe('server-managed AI model', () => {
  let close: (() => void) | null = null;
  afterEach(() => close?.());

  it('downloads a missing model, preloads it and reports progress along the way', async () => {
    const o = await fakeOllama();
    close = () => o.server.close();
    const m = new ManagedOllama({ url: o.url, model: 'tiny:1b', autoStart: false, autoPull: true, log: () => undefined });
    expect((await m.status()).state).toBe('starting');
    const seen = new Set<string>();
    const poll = setInterval(() => void m.status().then((s) => seen.add(s.state!)), 5);
    await m.start();
    clearInterval(poll);
    expect(seen.has('downloading')).toBe(true);
    expect(await m.status()).toMatchObject({ available: true, state: 'ready', queued: 0 });
  });

  it('reports unavailable without crashing when nothing is running and auto-start is off', async () => {
    const m = new ManagedOllama({ url: 'http://127.0.0.1:9', model: 'x', autoStart: false, log: () => undefined });
    await m.start();
    expect(await m.status()).toMatchObject({ available: false, state: 'unavailable' });
    expect((await m.status()).reason).toMatch(/isn't reachable/);
  });

  it('runs one design at a time and turns requests away when the line is full', async () => {
    const o = await fakeOllama({ chatMs: 60 });
    close = () => o.server.close();
    const m = new ManagedOllama({ url: o.url, model: 'tiny:1b', autoStart: false, autoPull: true, maxQueue: 2, log: () => undefined });
    await m.start();
    const req = { prompt: 'table', mode: '3d' as const, imageSummary: null, examples: [] };
    const a = m.design(req);
    const b = m.design(req);
    expect((await m.status()).queued).toBe(2);
    await expect(m.design(req)).rejects.toThrow(/busy/);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.parts.length).toBeGreaterThan(0);
    expect(rb.parts.length).toBeGreaterThan(0);
    expect(o.chats()).toBe(2);
  });
});
