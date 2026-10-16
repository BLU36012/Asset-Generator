import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import { ENGINES } from '@asset-gen/shared';
import type { AppContext } from '../context';
import { nowIso } from '../db';
import { export2D, export3D, safeName, type ExportResult } from '../exporters';
import { feedbackContext } from '../feedback';
import { getGenerator, type GenerationInfo, type InputImage } from '../generators';
import { badRequest } from '../http';
import { toAsset, type AssetMeta, type AssetRow } from './dto';
import type { UploadRow } from './uploads';
import { parseName, parsePromptText, parseSettings, parseUploadIds } from './validate';

export function generateRouter(ctx: AppContext): Router {
  const router = Router();
  const findUpload = ctx.db.prepare('SELECT * FROM uploads WHERE id = ?');
  const insertAsset = ctx.db.prepare(`
    INSERT INTO assets (id, user_id, design_id, name, mode, format, engine, prompt, dir, file_name, mime,
                        preview_name, thumbnail_name, meta_json, generation_json, saved, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?)
  `);
  const findAsset = ctx.db.prepare('SELECT * FROM assets WHERE id = ?');

  router.post('/', async (req, res) => {
    const body = req.body ?? {};
    const settings = parseSettings(body);
    const prompt = parsePromptText(body.prompt);
    const uploadIds = parseUploadIds(body.uploadIds);
    if (!prompt && uploadIds.length === 0) throw badRequest('Add a text prompt, a photo or a video to generate from.');

    const images: InputImage[] = [];
    for (const id of uploadIds) {
      const row = findUpload.get(id) as UploadRow | undefined;
      if (!row) throw badRequest('One of the uploaded files has expired. Please add it again.');
      images.push({ data: await readFile(join(ctx.paths.uploads, row.file_path)), mime: row.mime });
    }

    const engine = ENGINES[settings.engine];
    const generator = getGenerator();
    const requestedName = parseName(body.name, '');
    // Past ratings of similar prompts: this user's first, then everyone's.
    const feedback = feedbackContext(ctx.db, { prompt, mode: settings.mode, userId: req.user?.id ?? null });
    const referenceMode = body.referenceMode ?? 'auto';
    if (!['auto', 'always', 'never'].includes(referenceMode)) throw badRequest('referenceMode must be auto, always or never.');
    const common = { prompt, images, engine, textModel: ctx.textModel, feedback, references: ctx.references, referenceMode };
    let result: ExportResult;
    let summary: string;
    let defaultName: string;
    let generation: GenerationInfo;

    // Exported file names follow the user's name when given, else the generator's.
    if (settings.mode === '3d') {
      const mesh = await generator.generate3D(common);
      result = await export3D(settings.format, mesh, engine, safeName(requestedName || mesh.name));
      ({ summary, name: defaultName, generation } = mesh);
    } else {
      const sheet = settings.format === 'spritesheet';
      const size = sheet ? Math.min(256, Math.floor(engine.maxTextureSize / 4)) : Math.min(512, engine.maxTextureSize);
      const sprite = await generator.generate2D({ ...common, size, frameCount: sheet ? 8 : 1 });
      result = await export2D(settings.format, sprite, safeName(requestedName || sprite.name));
      ({ summary, name: defaultName, generation } = sprite);
    }

    const id = randomUUID();
    const dir = join(ctx.paths.assets, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, result.file.fileName), result.file.data);
    await writeFile(join(dir, result.preview.fileName), result.preview.data);

    const meta: AssetMeta = { summary, spriteSheet: result.spriteSheet };
    insertAsset.run(
      id,
      req.user?.id ?? null,
      requestedName || defaultName.replace(/-/g, ' '),
      settings.mode,
      settings.format,
      settings.engine,
      prompt,
      id,
      result.file.fileName,
      result.file.mime,
      result.preview.fileName,
      JSON.stringify(meta),
      JSON.stringify(generation),
      nowIso(),
    );

    res.status(201).json({ asset: toAsset(findAsset.get(id) as unknown as AssetRow, null) });
  });

  return router;
}
