import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { requireAuth } from '../auth/middleware';
import type { AppContext } from '../context';
import { nowIso } from '../db';
import { badRequest, notFound } from '../http';
import { toDesign, type DesignRow } from './dto';
import type { UploadRow } from './uploads';
import { parseName, parsePromptText, parseSettings, parseUploadIds } from './validate';

export function designsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth);

  const list = ctx.db.prepare('SELECT * FROM designs WHERE user_id = ? ORDER BY updated_at DESC');
  const find = ctx.db.prepare('SELECT * FROM designs WHERE id = ? AND user_id = ?');
  const insert = ctx.db.prepare(`
    INSERT INTO designs (id, user_id, name, prompt, settings_json, upload_ids_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = ctx.db.prepare(
    'UPDATE designs SET name = ?, prompt = ?, settings_json = ?, upload_ids_json = ?, updated_at = ? WHERE id = ? AND user_id = ?',
  );
  const remove = ctx.db.prepare('DELETE FROM designs WHERE id = ? AND user_id = ?');
  const findUpload = ctx.db.prepare('SELECT * FROM uploads WHERE id = ?');
  const claimUpload = ctx.db.prepare('UPDATE uploads SET user_id = ? WHERE id = ? AND user_id IS NULL');

  const parseBody = (req: Request) => {
    const body = req.body ?? {};
    const prompt = parsePromptText(body.prompt);
    const uploadIds = parseUploadIds(body.uploadIds);
    for (const id of uploadIds) {
      const upload = findUpload.get(id) as UploadRow | undefined;
      if (!upload || (upload.user_id !== null && upload.user_id !== req.user!.id)) {
        throw badRequest('One of the uploaded files has expired. Please add it again.');
      }
    }
    return {
      name: parseName(body.name, prompt.slice(0, 40) || 'Untitled design'),
      prompt,
      settings: parseSettings(body.settings ?? {}),
      uploadIds,
    };
  };

  const getOwned = (req: Request): DesignRow => {
    const row = find.get(req.params.id as string, req.user!.id) as DesignRow | undefined;
    if (!row) throw notFound('Design not found.');
    return row;
  };

  router.get('/', (req, res) => {
    const rows = list.all(req.user!.id) as unknown as DesignRow[];
    res.json({ designs: rows.map(toDesign) });
  });

  router.get('/:id', (req, res) => {
    res.json({ design: toDesign(getOwned(req)) });
  });

  router.post('/', (req, res) => {
    const d = parseBody(req);
    const id = randomUUID();
    const now = nowIso();
    insert.run(id, req.user!.id, d.name, d.prompt, JSON.stringify(d.settings), JSON.stringify(d.uploadIds), now, now);
    for (const uploadId of d.uploadIds) claimUpload.run(req.user!.id, uploadId);
    res.status(201).json({ design: toDesign(find.get(id, req.user!.id) as unknown as DesignRow) });
  });

  router.put('/:id', (req, res) => {
    const existing = getOwned(req);
    const d = parseBody(req);
    update.run(d.name, d.prompt, JSON.stringify(d.settings), JSON.stringify(d.uploadIds), nowIso(), existing.id, req.user!.id);
    for (const uploadId of d.uploadIds) claimUpload.run(req.user!.id, uploadId);
    res.json({ design: toDesign(find.get(existing.id, req.user!.id) as unknown as DesignRow) });
  });

  router.delete('/:id', (req, res) => {
    const existing = getOwned(req);
    remove.run(existing.id, req.user!.id);
    res.json({ ok: true });
  });

  return router;
}
