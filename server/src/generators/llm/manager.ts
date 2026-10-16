import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TextModelState } from '@asset-gen/shared';
import type { Blueprint } from './blueprint';
import { OllamaTextModel, type TextModel, type TextModelStatus } from './ollama';
import type { DesignRequest } from './prompt';

export interface ManagerOptions {
  url: string;
  model: string;
  timeoutMs?: number;
  /** Start `ollama serve` if nothing answers at a local URL. */
  autoStart?: boolean;
  /** Download the model if the server doesn't have it. */
  autoPull?: boolean;
  /** Explicit path to the ollama executable. */
  binary?: string;
  /** Requests allowed to wait while one is being designed; more fall back to keywords. */
  maxQueue?: number;
  log?: (msg: string) => void;
}

/**
 * Runs the AI text model as part of the API server: finds or starts Ollama,
 * downloads the model on first use, preloads it, and queues requests so the GPU
 * handles one design at a time. Website users never install or run anything.
 */
export class ManagedOllama implements TextModel {
  provider = 'ollama';
  model: string;
  private client: OllamaTextModel;
  private url: string;
  private opts: ManagerOptions;
  private state: TextModelState = 'starting';
  private reason: string | undefined;
  private progress: number | undefined;
  private child: ChildProcess | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private started: Promise<void> | null = null;

  constructor(opts: ManagerOptions) {
    this.opts = opts;
    this.url = opts.url.replace(/\/+$/, '');
    this.model = opts.model;
    this.client = new OllamaTextModel({ url: this.url, model: this.model, timeoutMs: opts.timeoutMs });
  }

  private log(msg: string) {
    (this.opts.log ?? console.log)(`[ai] ${msg}`);
  }

  /** Brings the model up in the background; safe to call more than once. */
  start(): Promise<void> {
    this.started ??= this.bringUp().catch((err) => {
      this.state = 'unavailable';
      this.reason = err instanceof Error ? err.message : String(err);
      this.log(`not available: ${this.reason}`);
    });
    return this.started;
  }

  private async reachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async bringUp() {
    this.state = 'starting';
    if (!(await this.reachable())) {
      if (!this.opts.autoStart || !isLocal(this.url)) {
        throw new Error(`The AI service isn't reachable at ${this.url}.`);
      }
      const bin = this.opts.binary || findOllama();
      if (!bin) throw new Error('The AI service (Ollama) is not installed on the server.');
      this.log(`starting ${bin} serve`);
      this.child = spawn(bin, ['serve'], {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, OLLAMA_HOST: new URL(this.url).host },
      });
      this.child.on('exit', () => {
        this.child = null;
        this.state = 'unavailable';
        this.reason = 'The AI service stopped.';
        this.started = null; // allow a later restart attempt
      });
      const deadline = Date.now() + 30_000;
      while (!(await this.reachable())) {
        if (Date.now() > deadline) throw new Error('The AI service did not start within 30 seconds.');
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const status = await this.client.status(true);
    if (!status.available) {
      if (!this.opts.autoPull) throw new Error(status.reason ?? 'The model is not downloaded.');
      await this.pull();
    }

    this.state = 'loading';
    this.log(`loading ${this.model}`);
    await this.client.warmUp();
    this.state = 'ready';
    this.reason = undefined;
    this.log(`ready: ${this.model}`);
  }

  private async pull() {
    this.state = 'downloading';
    this.progress = 0;
    this.log(`downloading ${this.model}`);
    const res = await fetch(`${this.url}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`Model download failed (HTTP ${res.status}).`);

    // Ollama streams one JSON object per line; layers report completed/total bytes.
    const layers = new Map<string, { completed: number; total: number }>();
    let buffer = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += Buffer.from(chunk).toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string };
        if (msg.error) throw new Error(`Model download failed: ${msg.error}`);
        if (msg.digest && msg.total) layers.set(msg.digest, { completed: msg.completed ?? 0, total: msg.total });
        const total = [...layers.values()].reduce((s, l) => s + l.total, 0);
        if (total) this.progress = [...layers.values()].reduce((s, l) => s + l.completed, 0) / total;
      }
    }
    this.progress = undefined;
  }

  async status(): Promise<TextModelStatus> {
    if (this.state === 'ready' && !(await this.client.status()).available) {
      // The service went away after start-up (e.g. it was closed); try to bring it back.
      this.state = 'unavailable';
      this.reason = 'The AI service stopped responding; restarting it.';
      this.started = null;
      void this.start();
    }
    return {
      available: this.state === 'ready',
      state: this.state,
      reason: this.state === 'ready' ? undefined : (this.reason ?? describe(this.state)),
      progress: this.progress,
      queued: this.waiting,
    };
  }

  /** One design at a time on the GPU; extra requests wait in line, a full line is turned away. */
  async design(req: DesignRequest): Promise<Blueprint> {
    if (this.waiting >= (this.opts.maxQueue ?? 6)) throw new Error('the AI model is busy with other requests');
    this.waiting++;
    const run = this.chain.then(() => this.client.design(req));
    this.chain = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.waiting--;
    }
  }

  async warmUp(): Promise<boolean> {
    await this.start();
    return this.state === 'ready';
  }

  /** Stops the Ollama process if this server started it. */
  stop() {
    this.child?.kill();
    this.child = null;
  }
}

function describe(state: TextModelState): string {
  switch (state) {
    case 'starting':
      return 'The AI model is starting on the server.';
    case 'downloading':
      return 'The server is downloading the AI model.';
    case 'loading':
      return 'The AI model is loading on the server.';
    default:
      return 'The AI model is unavailable on the server.';
  }
}

function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** Looks for the ollama executable on PATH and in the default install locations. */
export function findOllama(): string | null {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ollama'], { encoding: 'utf8', windowsHide: true });
  const onPath = probe.status === 0 ? probe.stdout.split(/\r?\n/)[0]?.trim() : '';
  if (onPath) return onPath;
  const candidates = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama.exe',
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
    '/opt/homebrew/bin/ollama',
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** The server-managed model; TEXT_MODEL=none disables it. */
export function textModelFromEnv(env: NodeJS.ProcessEnv = process.env): TextModel | null {
  if (env.TEXT_MODEL === 'none') return null;
  return new ManagedOllama({
    url: env.OLLAMA_URL || 'http://localhost:11434',
    model: env.OLLAMA_MODEL || 'qwen2.5:3b',
    timeoutMs: Number(env.OLLAMA_TIMEOUT_MS) || undefined,
    autoStart: env.OLLAMA_AUTOSTART !== 'false',
    autoPull: env.OLLAMA_AUTOPULL !== 'false',
    binary: env.OLLAMA_BIN || undefined,
    maxQueue: Number(env.OLLAMA_MAX_QUEUE) || undefined,
  });
}