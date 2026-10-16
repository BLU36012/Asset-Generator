import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { MAX_UPLOADS, type Upload } from '@asset-gen/shared';
import type { AppContext } from '../context';
import { nowIso } from '../db';
import { badRequest, notFound } from '../http';

const ALLOWED: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export interface UploadRow {
  id: string;
  user_id: string | null;
  file_path: string;
  mime: string;
  created_at: string;
}

/**
 * Images and client-extracted video frames. Uploads start unowned and are claimed
 * by a user when a design referencing them is saved; unclaimed ones expire.
 */
export function uploadsRouter(ctx: AppContext): Router {
  const router = Router();
  const insert = ctx.db.prepare('INSERT INTO uploads (id, user_id, file_path, mime, created_at) VALUES (?, NULL, ?, ?, ?)');
  const find = ctx.db.prepare('SELECT * FROM uploads WHERE id = ?');

  const upload = multer({
    storage: multer.diskStorage({
      destination: ctx.paths.uploads,
      filename: (_req, file, cb) => cb(null, randomUUID() + (ALLOWED[file.mimetype] ?? extname(file.originalname))),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: MAX_UPLOADS },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED[file.mimetype]) cb(null, true);
      else cb(badRequest('Only PNG, JPG and WebP images are accepted.'));
    },
  });

  router.post('/', upload.array('files', MAX_UPLOADS), (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw badRequest('No files received.');
    const uploads: Upload[] = files.map((file) => {
      const id = randomUUID();
      insert.run(id, file.filename, file.mimetype, nowIso());
      return { id, url: `/api/uploads/${id}`, mime: file.mimetype };
    });
    res.status(201).json({ uploads });
  });

  router.get('/:id', (req, res) => {
    const row = find.get(req.params.id) as UploadRow | undefined;
    if (!row) throw notFound('Upload not found.');
    res.type(row.mime).sendFile(join(ctx.paths.uploads, row.file_path));
  });

  return router;
}
