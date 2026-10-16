export type EngineId = 'unity' | 'godot' | 'roblox' | 'unreal';

export interface EngineProfile {
  id: EngineId;
  label: string;
  /** Human description of the engine's native unit. */
  unitName: string;
  /**
   * Multiplier applied to meter-based geometry for formats that carry no unit
   * metadata (OBJ). glTF is meters by spec and FBX declares its own units, so
   * those formats are never rescaled.
   */
  objScale: number;
  upAxis: 'Y' | 'Z';
  /** Largest texture edge (px) the engine accepts without downscaling. */
  maxTextureSize: number;
  recommended: { '3d': string; '2d': string };
  importTip: string;
}

export const ENGINES: Record<EngineId, EngineProfile> = {
  unity: {
    id: 'unity',
    label: 'Unity',
    unitName: 'meters',
    objScale: 1,
    upAxis: 'Y',
    maxTextureSize: 8192,
    recommended: { '3d': 'fbx', '2d': 'png' },
    importTip: 'Drag the file into the Project window. For GLB/glTF install the glTFast package (com.unity.cloud.gltfast).',
  },
  godot: {
    id: 'godot',
    label: 'Godot',
    unitName: 'meters',
    objScale: 1,
    upAxis: 'Y',
    maxTextureSize: 16384,
    recommended: { '3d': 'glb', '2d': 'png' },
    importTip: 'Copy the file into your project folder; Godot imports GLB/glTF natively as a scene.',
  },
  roblox: {
    id: 'roblox',
    label: 'Roblox Studio',
    unitName: 'studs (1 stud ≈ 0.28 m)',
    objScale: 1 / 0.28,
    upAxis: 'Y',
    maxTextureSize: 1024,
    recommended: { '3d': 'obj', '2d': 'png' },
    importTip: 'Use Avatar/Home → Import 3D for models, or the Asset Manager for images (max 1024×1024).',
  },
  unreal: {
    id: 'unreal',
    label: 'Unreal Engine',
    unitName: 'centimeters',
    objScale: 100,
    upAxis: 'Z',
    maxTextureSize: 8192,
    recommended: { '3d': 'fbx', '2d': 'png' },
    importTip: 'Drag the file into the Content Browser. UE5 imports FBX, OBJ and glTF/GLB via Interchange.',
  },
};

export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[];

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && value in ENGINES;
}
