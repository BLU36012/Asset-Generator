import type { EngineId } from './engines';

export type Mode = '3d' | '2d';
export type FormatId = 'glb' | 'gltf' | 'obj' | 'fbx' | 'png' | 'jpg' | 'tga' | 'spritesheet';

/** native = imports out of the box, partial = works with caveats, none = not importable. */
export type Support = 'native' | 'partial' | 'none';

export interface FormatInfo {
  id: FormatId;
  label: string;
  mode: Mode;
  description: string;
  support: Record<EngineId, Support>;
  notes?: Partial<Record<EngineId, string>>;
}

export const FORMATS: Record<FormatId, FormatInfo> = {
  glb: {
    id: 'glb',
    label: 'GLB (.glb)',
    mode: '3d',
    description: 'Binary glTF 2.0: mesh, materials and textures in a single file.',
    support: { unity: 'partial', godot: 'native', roblox: 'native', unreal: 'native' },
    notes: { unity: 'Requires the glTFast package.' },
  },
  gltf: {
    id: 'gltf',
    label: 'glTF (.gltf + .bin, zipped)',
    mode: '3d',
    description: 'Text glTF 2.0 with separate binary buffer and texture files.',
    support: { unity: 'partial', godot: 'native', roblox: 'native', unreal: 'native' },
    notes: { unity: 'Requires the glTFast package.' },
  },
  obj: {
    id: 'obj',
    label: 'OBJ (.obj + .mtl, zipped)',
    mode: '3d',
    description: 'Wavefront OBJ with an MTL material file and texture. Scaled to the engine’s units.',
    support: { unity: 'native', godot: 'native', roblox: 'native', unreal: 'native' },
  },
  fbx: {
    id: 'fbx',
    label: 'FBX (.fbx, ASCII 7.4)',
    mode: '3d',
    description: 'Autodesk FBX (ASCII). Textured models are zipped with their texture.',
    support: { unity: 'native', godot: 'native', roblox: 'partial', unreal: 'native' },
    notes: { roblox: 'Roblox prefers binary FBX; use OBJ or GLB for Roblox.' },
  },
  png: {
    id: 'png',
    label: 'PNG (.png)',
    mode: '2d',
    description: 'Lossless image with transparency. Works as a sprite, decal or texture everywhere.',
    support: { unity: 'native', godot: 'native', roblox: 'native', unreal: 'native' },
  },
  jpg: {
    id: 'jpg',
    label: 'JPG (.jpg)',
    mode: '2d',
    description: 'Compressed image without transparency (background is flattened to white).',
    support: { unity: 'native', godot: 'native', roblox: 'native', unreal: 'native' },
  },
  tga: {
    id: 'tga',
    label: 'TGA (.tga)',
    mode: '2d',
    description: 'Uncompressed 32-bit Targa with alpha, common for game textures.',
    support: { unity: 'native', godot: 'native', roblox: 'native', unreal: 'native' },
  },
  spritesheet: {
    id: 'spritesheet',
    label: 'Sprite sheet (.png + .json, zipped)',
    mode: '2d',
    description: 'Horizontal animation strip plus JSON frame data.',
    support: { unity: 'native', godot: 'native', roblox: 'partial', unreal: 'partial' },
    notes: {
      unity: 'Slice with Sprite Editor → Grid By Cell Count.',
      godot: 'Use AnimatedSprite2D or Sprite2D hframes.',
      roblox: 'Animate with ImageRectOffset/ImageRectSize in a script.',
      unreal: 'Import via Paper2D and extract sprites.',
    },
  },
};

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && value in FORMATS;
}

export function formatsForMode(mode: Mode): FormatInfo[] {
  return FORMAT_IDS.map((id) => FORMATS[id]).filter((f) => f.mode === mode);
}

export function isSupported(format: FormatId, engine: EngineId): boolean {
  return FORMATS[format].support[engine] !== 'none';
}
