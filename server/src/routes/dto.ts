import type { Asset, Design, DesignSettings, EngineId, FeedbackValue, FormatId, Mode, SpriteSheetMeta } from '@asset-gen/shared';
import type { GenerationInfo } from '../generators';

export interface AssetRow {
  id: string;
  user_id: string | null;
  design_id: string | null;
  name: string;
  mode: Mode;
  format: FormatId;
  engine: EngineId;
  prompt: string;
  dir: string;
  file_name: string;
  mime: string;
  preview_name: string;
  thumbnail_name: string | null;
  meta_json: string | null;
  generation_json: string | null;
  saved: number;
  created_at: string;
}

export function generationOf(row: AssetRow): GenerationInfo | null {
  return row.generation_json ? (JSON.parse(row.generation_json) as GenerationInfo) : null;
}

export interface AssetMeta {
  summary: string;
  spriteSheet: SpriteSheetMeta | null;
}

export function toAsset(row: AssetRow, feedback: FeedbackValue | null): Asset {
  const meta: AssetMeta = row.meta_json ? JSON.parse(row.meta_json) : { summary: '', spriteSheet: null };
  const generation = generationOf(row);
  const base = `/api/assets/${row.id}`;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    format: row.format,
    engine: row.engine,
    prompt: row.prompt,
    summary: meta.summary,
    designId: row.design_id,
    fileName: row.file_name,
    saved: row.saved === 1,
    createdAt: row.created_at,
    downloadUrl: `${base}/download`,
    previewUrl: `${base}/preview`,
    thumbnailUrl: row.thumbnail_name ? `${base}/thumbnail` : row.mode === '2d' ? `${base}/preview` : null,
    spriteSheet: meta.spriteSheet,
    source: generation?.source ?? (row.prompt ? 'keywords' : 'image'),
    model: generation?.model ?? null,
    feedback,
    reference: generation?.reference ?? null,
  };
}

export interface DesignRow {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  settings_json: string;
  upload_ids_json: string;
  created_at: string;
  updated_at: string;
}

export function toDesign(row: DesignRow): Design {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    settings: JSON.parse(row.settings_json) as DesignSettings,
    uploadIds: JSON.parse(row.upload_ids_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
