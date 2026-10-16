import type { TextModelState } from '@asset-gen/shared';
import type { Blueprint } from './blueprint';
import { LAYOUT_SCHEMA, layoutToBlueprint, sanitizeLayout } from './layout';
import { buildDesignMessages, type DesignRequest } from './prompt';

export interface TextModelStatus {
  available: boolean;
  reason?: string;
  state?: TextModelState;
  progress?: number;
  queued?: number;
}

/** Anything that can turn a description into a blueprint. */
export interface TextModel {
  provider: string;
  model: string;
  /** Whether the model can be used right now (cached briefly). */
  status(): Promise<TextModelStatus>;
  design(req: DesignRequest): Promise<Blueprint>;
  /** Optional: preload the model so the first request is fast. */
  warmUp?(): Promise<boolean>;
  /** Optional: release resources (e.g. a child process) on shutdown. */
  stop?(): void;
}

export interface OllamaOptions {
  url: string;
  model: string;
  timeoutMs?: number;
}

const STATUS_TTL_MS = 15_000;

/** Talks to a local Ollama server (https://ollama.com) over its HTTP API. */
export class OllamaTextModel implements TextModel {
  provider = 'ollama';
  model: string;
  private url: string;
  private timeoutMs: number;
  private cached: { at: number; value: TextModelStatus } | null = null;

  constructor(opts: OllamaOptions) {
    this.url = opts.url.replace(/\/+$/, '');
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async status(fresh = false): Promise<TextModelStatus> {
    if (!fresh && this.cached && Date.now() - this.cached.at < STATUS_TTL_MS) return this.cached.value;
    let value: TextModelStatus;
    try {
      const res = await fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: { name: string }[] };
      const names = (body.models ?? []).map((m) => m.name);
      const wanted = this.model.includes(':') ? this.model : `${this.model}:latest`;
      value = names.includes(wanted)
        ? { available: true }
        : { available: false, reason: `Ollama is running but the model "${this.model}" isn't downloaded (run: ollama pull ${this.model}).` };
    } catch {
      value = { available: false, reason: `Ollama isn't reachable at ${this.url}.` };
    }
    this.cached = { at: Date.now(), value };
    return value;
  }

  async design(req: DesignRequest): Promise<Blueprint> {
    const res = await fetch(`${this.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        messages: buildDesignMessages(req),
        stream: false,
        format: LAYOUT_SCHEMA,
        keep_alive: '15m',
        // A little randomness keeps "try again" from repeating the same design.
        options: { temperature: req.examples.some((e) => !e.liked) ? 0.8 : 0.5, num_ctx: 8192 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { message?: { content?: string } };
    const content = body.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('The text model did not return valid JSON.');
    }
    return layoutToBlueprint(sanitizeLayout(parsed));
  }

  /**
   * Loads the model into memory ahead of the first request (the first load can
   * take a minute or more). Ollama keeps it resident for `keep_alive`.
   */
  async warmUp(): Promise<boolean> {
    if (!(await this.status(true)).available) return false;
    try {
      const res = await fetch(`${this.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs * 2),
        body: JSON.stringify({ model: this.model, keep_alive: '15m' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
