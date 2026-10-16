import type { EngineProfile, GenerationSource, ReferenceInfo, ReferenceMode } from '@asset-gen/shared';
import type { ReferenceFinder } from '../references';
import type { Blueprint } from './llm/blueprint';
import type { TextModel } from './llm/ollama';
import type { FeedbackExample } from './llm/prompt';

export type Rgb = [number, number, number];

/** How an asset was produced; stored with the asset and copied into feedback. */
export interface GenerationInfo {
  /** text-model: designed by the LLM; feedback-reuse: a liked blueprint was reused; web-reference: modeled from an online image. */
  source: GenerationSource;
  model: string | null;
  form: string;
  blueprint: Blueprint | null;
  reference: ReferenceInfo | null;
}

/** Past ratings relevant to the current prompt, most relevant first. */
export interface FeedbackContext {
  examples: FeedbackExample[];
  /** A liked blueprint for a near-identical prompt, usable when no text model is available. */
  reusable: { prompt: string; blueprint: Blueprint } | null;
  /** How often this user disliked results for (nearly) this exact prompt. */
  repeatDislikes: number;
  /** Reference images (by URL) that were liked / disliked for similar prompts. */
  likedReferences: string[];
  rejectedReferences: string[];
}

export interface MeshMaterial {
  name: string;
  /** sRGB, 0..1 */
  color: Rgb;
  /** When true the material samples MeshData.texture (color acts as a tint of white). */
  textured: boolean;
  roughness: number;
  metallic: number;
  /** sRGB glow color; absent = no emission. */
  emissive?: Rgb;
}

/** One draw call: an indexed triangle list using a single material. UVs use glTF convention (v=0 at top). */
export interface MeshPart {
  name: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  material: number;
}

export interface TextureImage {
  png: Uint8Array;
  width: number;
  height: number;
}

/** Geometry in meters, Y-up, pivot at the bottom-center of the object. */
export interface MeshData {
  name: string;
  /** Short note on how the input was interpreted, shown to the user. */
  summary: string;
  parts: MeshPart[];
  materials: MeshMaterial[];
  texture?: TextureImage;
  generation: GenerationInfo;
}

export interface ImageFrame {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major from the top-left. */
  data: Uint8ClampedArray;
}

export interface SpriteData {
  name: string;
  summary: string;
  frames: ImageFrame[];
  fps: number;
  generation: GenerationInfo;
}

export interface InputImage {
  data: Buffer;
  mime: string;
}

export interface GeneratorInput {
  prompt: string;
  images: InputImage[];
  engine: EngineProfile;
  /** Language model that designs from the text; null = keyword parsing only. */
  textModel?: TextModel | null;
  feedback?: FeedbackContext;
  /** Finds reference images online for text-only prompts; null = disabled. */
  references?: ReferenceFinder | null;
  referenceMode?: ReferenceMode;
}

export interface Generator2DInput extends GeneratorInput {
  size: number;
  frameCount: number;
}

/**
 * The seam between the app and whatever produces assets. The mock implementation
 * builds procedural shapes; a real AI backend (Meshy, Tripo, a self-hosted model…)
 * implements the same interface and is selected in generators/index.ts.
 */
export interface AssetGenerator {
  id: string;
  generate3D(input: GeneratorInput): Promise<MeshData>;
  generate2D(input: Generator2DInput): Promise<SpriteData>;
}
