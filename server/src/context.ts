import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb, type Db } from './db';
import { textModelFromEnv } from './generators/llm/manager';
import type { TextModel } from './generators/llm/ollama';
import { referenceFinderFromEnv, type ReferenceFinder } from './references';

export interface AppConfig {
  storageDir: string;
  jwtSecret?: string;
  secureCookies?: boolean;
  /** Language model for text understanding; defaults to Ollama from env, null disables it. */
  textModel?: TextModel | null;
  /** Web reference image search; defaults to Wikimedia + Openverse, null disables it. */
  references?: ReferenceFinder | null;
}

/** Shared dependencies handed to every router. */
export interface AppContext {
  db: Db;
  jwtSecret: string;
  secureCookies: boolean;
  textModel: TextModel | null;
  references: ReferenceFinder | null;
  paths: {
    root: string;
    uploads: string;
    assets: string;
  };
}

export function createContext(config: AppConfig): AppContext {
  const root = resolve(config.storageDir);
  const paths = { root, uploads: join(root, 'uploads'), assets: join(root, 'assets') };
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });

  return {
    db: openDb(join(root, 'app.db')),
    jwtSecret: config.jwtSecret || loadOrCreateSecret(join(root, '.jwt-secret')),
    secureCookies: config.secureCookies ?? false,
    textModel: config.textModel === undefined ? textModelFromEnv() : config.textModel,
    references: config.references === undefined ? referenceFinderFromEnv(join(root, 'references')) : config.references,
    paths,
  };
}

function loadOrCreateSecret(file: string): string {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
