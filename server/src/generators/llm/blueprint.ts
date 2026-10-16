import { sanitizeLayout, type LayoutDesign } from './layout';

/**
 * A blueprint is a list of primitive parts with real-world sizes, absolute
 * positions, rotations, colors and materials. The language model writes a
 * relative layout (see layout.ts) that is resolved into a blueprint; the
 * builders turn it into a mesh or sprite, so any describable object can be made.
 */

import { MAX_PARTS, PART_MATERIALS, PART_SHAPES, type PartMaterial, type PartShape } from './parts';

export { MAX_PARTS, PART_MATERIALS, PART_SHAPES, type PartMaterial, type PartShape };

type Vec3 = [number, number, number];

export interface BlueprintPart {
  name: string;
  shape: PartShape;
  /** Width (x), height (y), depth (z) in meters. */
  size: Vec3;
  /** Center of the part in meters; y up, +z is the front. */
  position: Vec3;
  /** Degrees around x, y, z (applied in that order). */
  rotation: Vec3;
  /** #rrggbb */
  color: string;
  material: PartMaterial;
}

export interface Blueprint {
  name: string;
  summary: string;
  /** False when the text only describes a style ("rusty metal, wide") rather than naming an object. */
  textNamesObject: boolean;
  /** Absolute, fully expanded parts ready to build. */
  parts: BlueprintPart[];
  /** The relative design the model wrote, kept so liked results can be shown back to it as examples. */
  layout?: LayoutDesign;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function vec(value: unknown, fallback: number, lo: number, hi: number): Vec3 {
  const arr = Array.isArray(value) ? value : [];
  return [0, 1, 2].map((i) => {
    const n = Number(arr[i]);
    return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  }) as Vec3;
}

function color(value: unknown): string {
  const s = String(value ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + [...s.slice(1)].map((c) => c + c).join('')).toLowerCase();
  return '#9a9aa2';
}

function text(value: unknown, fallback: string, max: number): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return (s || fallback).slice(0, max);
}

/**
 * Turns untrusted model output into a valid blueprint: unknown shapes and
 * materials fall back to safe defaults, numbers are clamped, and empty results
 * are rejected. Accepts both snake_case (model output) and camelCase (stored).
 */
export function sanitizeBlueprint(raw: unknown): Blueprint {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawParts = Array.isArray(obj.parts) ? obj.parts.slice(0, MAX_PARTS) : [];

  const parts: BlueprintPart[] = rawParts
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p, i) => ({
      name: text(p.name, `part ${i + 1}`, 40),
      shape: (PART_SHAPES as readonly string[]).includes(String(p.shape)) ? (p.shape as PartShape) : 'box',
      size: vec(p.size, 0.1, 0.002, 50),
      position: vec(p.position, 0, -100, 100),
      rotation: vec(p.rotation, 0, -360, 360),
      color: color(p.color),
      material: (PART_MATERIALS as readonly string[]).includes(String(p.material)) ? (p.material as PartMaterial) : 'plastic',
    }));

  if (parts.length === 0) throw new Error('The text model returned no parts.');

  const named = obj.text_names_object ?? obj.textNamesObject;
  let layout: LayoutDesign | undefined;
  try {
    layout = obj.layout ? sanitizeLayout(obj.layout) : undefined;
  } catch {
    layout = undefined;
  }
  return {
    name: text(obj.name, 'asset', 60),
    summary: text(obj.summary, '', 240),
    textNamesObject: named === undefined ? true : Boolean(named),
    parts,
    ...(layout ? { layout } : {}),
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
