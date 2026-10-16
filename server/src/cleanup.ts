import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppContext } from './context';

const TTL_MS = 24 * 60 * 60 * 1000;

/** Deletes unsaved assets and unclaimed uploads older than 24 hours. */
export async function cleanupExpired(ctx: AppContext): Promise<{ assets: number; uploads: number }> {
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();

  const assets = ctx.db.prepare('SELECT id, dir FROM assets WHERE saved = 0 AND created_at < ?').all(cutoff) as { id: string; dir: string }[];
  for (const a of assets) await rm(join(ctx.paths.assets, a.dir), { recursive: true, force: true });
  ctx.db.prepare('DELETE FROM assets WHERE saved = 0 AND created_at < ?').run(cutoff);

  const uploads = ctx.db.prepare('SELECT id, file_path FROM uploads WHERE user_id IS NULL AND created_at < ?').all(cutoff) as {
    id: string;
    file_path: string;
  }[];
  for (const u of uploads) await rm(join(ctx.paths.uploads, u.file_path), { force: true });
  ctx.db.prepare('DELETE FROM uploads WHERE user_id IS NULL AND created_at < ?').run(cutoff);

  return { assets: assets.length, uploads: uploads.length };
}
