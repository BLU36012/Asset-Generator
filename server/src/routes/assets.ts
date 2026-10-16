import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Request } from 'express';
import { requireAuth } from '../auth/middleware';
import type { AppContext } from '../context';
import { myFeedback, recordFeedback } from '../feedback';
import { badRequest, notFound } from '../http';
import { generationOf, toAsset, type AssetRow } from './dto';
import { parseName } from './validate';

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_COMMENT = 500;

export function assetsRouter(ctx: AppContext): Router {
  const router = Router();
  const find = ctx.db.prepare('SELECT * FROM assets WHERE id = ?');
  const listSaved = ctx.db.prepare('SELECT * FROM assets WHERE user_id = ? AND saved = 1 ORDER BY created_at DESC');
  const findDesign = ctx.db.prepare('SELECT id FROM designs WHERE id = ? AND user_id = ?');
  const save = ctx.db.prepare(
    'UPDATE assets SET user_id = ?, saved = 1, name = ?, design_id = ?, thumbnail_name = COALESCE(?, thumbnail_name) WHERE id = ?',
  );
  const remove = ctx.db.prepare('DELETE FROM assets WHERE id = ?');

  /**
   * Saved assets are private to their owner. Unsaved ones are reachable by anyone
   * holding the (unguessable) id, so guests can download what they just generated.
   */
  const readable = (req: Request): AssetRow => {
    const row = find.get(req.params.id as string) as AssetRow | undefined;
    if (!row || (row.saved === 1 && row.user_id !== req.user?.id)) throw notFound('Asset not found.');
    return row;
  };

  const owned = (req: Request): AssetRow => {
    const row = find.get(req.params.id as string) as AssetRow | undefined;
    if (!row || row.user_id !== req.user!.id) throw notFound('Asset not found.');
    return row;
  };

  const dto = (row: AssetRow, req: Request) => toAsset(row, myFeedback(ctx.db, row.id, req.user?.id ?? null));

  router.get('/', requireAuth, (req, res) => {
    const rows = listSaved.all(req.user!.id) as unknown as AssetRow[];
    res.json({ assets: rows.map((r) => dto(r, req)) });
  });

  router.get('/:id', (req, res) => {
    res.json({ asset: dto(readable(req), req) });
  });

  /** "Do you like this result?" Anyone who can see the asset may rate it; signed-in ratings personalize. */
  router.post('/:id/feedback', (req, res) => {
    const row = readable(req);
    const liked = req.body?.liked;
    if (typeof liked !== 'boolean') throw badRequest('liked must be true or false.');
    const rawComment = req.body?.comment;
    if (rawComment !== undefined && typeof rawComment !== 'string') throw badRequest('comment must be text.');
    const comment = rawComment?.trim().slice(0, MAX_COMMENT) || null;

    recordFeedback(ctx.db, {
      assetId: row.id,
      userId: req.user?.id ?? null,
      prompt: row.prompt,
      mode: row.mode,
      liked,
      comment,
      generation: generationOf(row),
    });
    res.json({ asset: dto(row, req) });
  });

  router.get('/:id/download', (req, res) => {
    const row = readable(req);
    res.download(join(ctx.paths.assets, row.dir, row.file_name), row.file_name);
  });

  router.get('/:id/preview', (req, res) => {
    const row = readable(req);
    res.sendFile(join(ctx.paths.assets, row.dir, row.preview_name));
  });

  router.get('/:id/thumbnail', (req, res) => {
    const row = readable(req);
    if (!row.thumbnail_name) throw notFound('No thumbnail.');
    res.sendFile(join(ctx.paths.assets, row.dir, row.thumbnail_name));
  });

  /** Claims a freshly generated asset into the signed-in user's library. */
  router.post('/:id/save', requireAuth, async (req, res) => {
    const row = find.get(req.params.id as string) as AssetRow | undefined;
    if (!row || (row.user_id !== null && row.user_id !== req.user!.id)) throw notFound('Asset not found.');

    const designId = req.body?.designId ?? null;
    if (designId !== null && !findDesign.get(designId, req.user!.id)) throw badRequest('Design not found.');

    let thumbnailName: string | null = null;
    const thumbnail = req.body?.thumbnail;
    if (typeof thumbnail === 'string' && thumbnail.startsWith('data:image/png;base64,')) {
      const png = Buffer.from(thumbnail.slice('data:image/png;base64,'.length), 'base64');
      if (png.length > MAX_THUMBNAIL_BYTES) throw badRequest('Thumbnail is too large.');
      thumbnailName = 'thumbnail.png';
      await writeFile(join(ctx.paths.assets, row.dir, thumbnailName), png);
    }

    save.run(req.user!.id, parseName(req.body?.name, row.name), designId, thumbnailName, row.id);
    res.json({ asset: dto(find.get(row.id) as unknown as AssetRow, req) });
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    const row = owned(req);
    remove.run(row.id);
    await rm(join(ctx.paths.assets, row.dir), { recursive: true, force: true });
    res.json({ ok: true });
  });

  return router;
}
