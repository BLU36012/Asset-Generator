import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  file_path  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS designs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  settings_json   TEXT NOT NULL,
  upload_ids_json TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
  design_id      TEXT REFERENCES designs(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  mode           TEXT NOT NULL,
  format         TEXT NOT NULL,
  engine         TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  dir            TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  mime           TEXT NOT NULL,
  preview_name   TEXT NOT NULL,
  thumbnail_name TEXT,
  meta_json      TEXT,
  saved          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

-- Ratings outlive the (possibly temporary) assets they rate, so everything needed
-- to learn from them is copied in rather than referenced.
CREATE TABLE IF NOT EXISTS feedback (
  id              TEXT PRIMARY KEY,
  asset_id        TEXT NOT NULL,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  prompt          TEXT NOT NULL,
  mode            TEXT NOT NULL,
  liked           INTEGER NOT NULL,
  comment         TEXT,
  generation_json TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_designs_user ON designs(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id, saved);
CREATE INDEX IF NOT EXISTS idx_feedback_asset ON feedback(asset_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
`;

/** Columns added after the first release; created on startup if an older database lacks them. */
const ADDED_COLUMNS: { table: string; column: string; type: string }[] = [{ table: 'assets', column: 'generation_json', type: 'TEXT' }];

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  for (const { table, column, type } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
