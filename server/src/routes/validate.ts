import { FORMATS, isEngineId, isFormatId, MAX_PROMPT, MAX_UPLOADS, type DesignSettings } from '@asset-gen/shared';
import { badRequest } from '../http';

export function parseSettings(body: Record<string, unknown>): DesignSettings {
  const { mode, engine, format } = body;
  if (mode !== '3d' && mode !== '2d') throw badRequest('mode must be "3d" or "2d".');
  if (!isEngineId(engine)) throw badRequest('Unknown engine.');
  if (!isFormatId(format)) throw badRequest('Unknown file type.');
  if (FORMATS[format].mode !== mode) throw badRequest(`${FORMATS[format].label} is not a ${mode.toUpperCase()} format.`);
  if (FORMATS[format].support[engine] === 'none') throw badRequest(`${FORMATS[format].label} can't be imported into that engine.`);
  return { mode, engine, format };
}

export function parsePromptText(value: unknown): string {
  const prompt = typeof value === 'string' ? value.trim() : '';
  if (prompt.length > MAX_PROMPT) throw badRequest(`Prompt must be ${MAX_PROMPT} characters or fewer.`);
  return prompt;
}

export function parseUploadIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw badRequest('uploadIds must be a list of ids.');
  if (value.length > MAX_UPLOADS) throw badRequest(`At most ${MAX_UPLOADS} images or video frames per asset.`);
  return value;
}

export function parseName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length > 80) throw badRequest('Name must be 80 characters or fewer.');
  return name || fallback;
}
