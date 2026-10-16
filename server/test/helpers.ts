import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import request from 'supertest';
import { createApp } from '../src/app';
import { createContext, type AppContext } from '../src/context';
import type { TextModel } from '../src/generators/llm/ollama';
import type { ReferenceFinder } from '../src/references';

export interface TestApp {
  ctx: AppContext;
  app: ReturnType<typeof createApp>;
  cleanup: () => void;
}

/** Tests never touch a real Ollama server; pass a fake TextModel to exercise that path. */
export function makeTestApp(opts: { textModel?: TextModel | null; references?: ReferenceFinder | null } = {}): TestApp {
  const dir = mkdtempSync(join(tmpdir(), 'asset-gen-test-'));
  // Tests never reach the internet either: reference search is off unless a fake finder is passed.
  const ctx = createContext({ storageDir: dir, jwtSecret: 'test-secret', textModel: opts.textModel ?? null, references: opts.references ?? null });
  return {
    ctx,
    app: createApp(ctx),
    cleanup: () => {
      ctx.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Registers a user and returns an agent that carries their session cookie. */
export async function signedInAgent(app: TestApp['app'], email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email, password: 'password123' }).expect(201);
  return agent;
}

export async function samplePng(width = 64, height = 48): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d02020';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#2040d0';
  ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
  return canvas.encode('png');
}
