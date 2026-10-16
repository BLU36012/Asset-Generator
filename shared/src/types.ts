import type { EngineId } from './engines';
import type { FormatId, Mode } from './formats';

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface DesignSettings {
  mode: Mode;
  engine: EngineId;
  format: FormatId;
}

/** A saved set of inputs + settings that can be re-opened and regenerated. */
export interface Design {
  id: string;
  name: string;
  prompt: string;
  settings: DesignSettings;
  uploadIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SpriteSheetMeta {
  frameCount: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
}

/** A generated output file. Unsaved assets are temporary and expire after 24 hours. */
export interface Asset {
  id: string;
  name: string;
  mode: Mode;
  format: FormatId;
  engine: EngineId;
  prompt: string;
  /** How the generator interpreted the input. */
  summary: string;
  designId: string | null;
  fileName: string;
  saved: boolean;
  createdAt: string;
  downloadUrl: string;
  previewUrl: string;
  thumbnailUrl: string | null;
  spriteSheet: SpriteSheetMeta | null;
  /** What produced the asset: the text model, a reused liked design, keyword matching or image analysis. */
  source: GenerationSource;
  /** Text model name when source is "text-model". */
  model: string | null;
  /** The current viewer's rating of this asset. */
  feedback: FeedbackValue | null;
  /** The openly licensed web image the shape was modeled from, if any. */
  reference: ReferenceInfo | null;
}

export type GenerationSource = 'text-model' | 'feedback-reuse' | 'keywords' | 'image' | 'web-reference';

/** Attribution for a web reference image (shown with the result; required by CC licenses). */
export interface ReferenceInfo {
  title: string;
  author: string | null;
  license: string;
  licenseUrl: string | null;
  /** Page describing the image (for attribution). */
  pageUrl: string;
  /** Thumbnail URL the image was analyzed from. */
  imageUrl: string;
  provider: 'Wikimedia Commons' | 'Openverse';
}

/** auto = use web references for objects that primitives model poorly; always / never force it. */
export type ReferenceMode = 'auto' | 'always' | 'never';

export type TextModelState = 'starting' | 'downloading' | 'loading' | 'ready' | 'unavailable';
export type FeedbackValue = 'like' | 'dislike';

export interface FeedbackRequest {
  liked: boolean;
  comment?: string;
}

export interface StatusResponse {
  textModel: {
    provider: string;
    model: string;
    available: boolean;
    reason?: string;
    state?: TextModelState;
    /** 0..1 while the server downloads the model. */
    progress?: number;
    /** Requests waiting for the model. */
    queued?: number;
  } | null;
  references: { enabled: boolean };
}

export interface Upload {
  id: string;
  url: string;
  mime: string;
}

export interface GenerateRequest {
  mode: Mode;
  prompt: string;
  uploadIds: string[];
  engine: EngineId;
  format: FormatId;
  name?: string;
  referenceMode?: ReferenceMode;
}

export interface ApiError {
  error: string;
}
