import type { EngineProfile, FormatId, SpriteSheetMeta } from '@asset-gen/shared';
import type { MeshData, SpriteData } from '../generators/types';
import { toFbx } from './fbx';
import { toGlb, toGltfZip } from './gltf';
import { encodePng, encodeSheet, sheetLayout, toJpg, toPng, toSpriteSheet, toTga } from './images';
import { toObjZip } from './obj';
import type { ExportedFile } from './util';

export { safeName } from './util';
export type { ExportedFile } from './util';

export interface ExportResult {
  file: ExportedFile;
  /** GLB for 3D, PNG for 2D: what the browser preview loads. */
  preview: ExportedFile;
  spriteSheet: SpriteSheetMeta | null;
}

export async function export3D(format: FormatId, mesh: MeshData, engine: EngineProfile, base: string): Promise<ExportResult> {
  const preview = await toGlb(mesh, base);
  let file: ExportedFile;
  switch (format) {
    case 'glb':
      file = preview;
      break;
    case 'gltf':
      file = await toGltfZip(mesh, base);
      break;
    case 'obj':
      file = await toObjZip(mesh, base, engine.objScale);
      break;
    case 'fbx':
      file = await toFbx(mesh, base);
      break;
    default:
      throw new Error(`${format} is not a 3D format`);
  }
  return { file, preview: { ...preview, fileName: 'preview.glb' }, spriteSheet: null };
}

export async function export2D(format: FormatId, sprite: SpriteData, base: string): Promise<ExportResult> {
  const first = sprite.frames[0];
  if (format === 'spritesheet') {
    const layout = sheetLayout(sprite.frames);
    return {
      file: await toSpriteSheet(sprite.frames, sprite.fps, base),
      preview: { data: await encodeSheet(sprite.frames), fileName: 'preview.png', mime: 'image/png' },
      spriteSheet: { frameCount: sprite.frames.length, fps: sprite.fps, ...layout },
    };
  }

  let file: ExportedFile;
  switch (format) {
    case 'png':
      file = await toPng(first, base);
      break;
    case 'jpg':
      file = await toJpg(first, base);
      break;
    case 'tga':
      file = toTga(first, base);
      break;
    default:
      throw new Error(`${format} is not a 2D format`);
  }
  const preview = format === 'png' ? file.data : await encodePng(first);
  return { file, preview: { data: preview, fileName: 'preview.png', mime: 'image/png' }, spriteSheet: null };
}
