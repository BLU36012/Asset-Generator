/** Vocabulary shared by blueprints (absolute) and layouts (relative). */

export const PART_SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'pyramid', 'wedge', 'dome'] as const;
export type PartShape = (typeof PART_SHAPES)[number];

export const PART_MATERIALS = [
  'metal',
  'wood',
  'stone',
  'glass',
  'plastic',
  'fabric',
  'organic',
  'crystal',
  'rubber',
  'ceramic',
  'glow',
] as const;
export type PartMaterial = (typeof PART_MATERIALS)[number];

export const MAX_PARTS = 32;
