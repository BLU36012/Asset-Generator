import type { MeshData } from '../generators/types';

export interface ExportedFile {
  data: Uint8Array;
  fileName: string;
  mime: string;
}

/** Lowercase, filesystem- and engine-safe base name. */
export function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'asset';
}

/** Material names made unique and safe for OBJ/FBX identifiers. */
export function materialNames(mesh: MeshData): string[] {
  return mesh.materials.map((m, i) => `${safeName(m.name)}_${i}`);
}

export function textureFileName(base: string): string {
  return `${base}_texture.png`;
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Compact decimal formatting for text formats. */
export function num(v: number): string {
  const s = v.toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}
