import type { Blueprint, BlueprintPart } from './blueprint';
import { MAX_PARTS, PART_MATERIALS, PART_SHAPES, type PartMaterial, type PartShape } from './parts';

/**
 * What the language model actually writes: parts described *relative to each
 * other* ("legs below the seat, at its corners"). Small models are good at that
 * and bad at 3D coordinate math, so the layout engine below does the math.
 */

export const SIDES = ['ground', 'on_top', 'below', 'left', 'right', 'front', 'back', 'center'] as const;
export const ALIGNS = ['center', 'front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export const ARRANGEMENTS = ['single', 'pair', 'corners', 'ring3', 'ring6'] as const;
export type Side = (typeof SIDES)[number];
export type Align = (typeof ALIGNS)[number];
export type Arrangement = (typeof ARRANGEMENTS)[number];

type Vec3 = [number, number, number];

export interface LayoutPart {
  name: string;
  shape: PartShape;
  /** Width x, height y, depth z in meters (before rotation). */
  size: Vec3;
  rotation: Vec3;
  color: string;
  material: PartMaterial;
  /** Name of an earlier part, or "ground". */
  attach_to: string;
  side: Side;
  align: Align;
  arrangement: Arrangement;
}

export interface LayoutDesign {
  name: string;
  summary: string;
  /** The model's short plan of parts, written before the numbers. */
  parts_plan: string;
  text_names_object: boolean;
  parts: LayoutPart[];
}

export const LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    parts_plan: { type: 'string' },
    summary: { type: 'string' },
    text_names_object: { type: 'boolean' },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          shape: { type: 'string', enum: [...PART_SHAPES] },
          size: { type: 'array', items: { type: 'number' } },
          attach_to: { type: 'string' },
          side: { type: 'string', enum: [...SIDES] },
          align: { type: 'string', enum: [...ALIGNS] },
          arrangement: { type: 'string', enum: [...ARRANGEMENTS] },
          rotation: { type: 'array', items: { type: 'number' } },
          color: { type: 'string' },
          material: { type: 'string', enum: [...PART_MATERIALS] },
        },
        required: ['name', 'shape', 'size', 'attach_to', 'side', 'align', 'arrangement', 'rotation', 'color', 'material'],
      },
    },
  },
  required: ['name', 'parts_plan', 'summary', 'text_names_object', 'parts'],
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

function vec(value: unknown, fallback: number, lo: number, hi: number): Vec3 {
  const arr = Array.isArray(value) ? value : [];
  return [0, 1, 2].map((i) => {
    const n = Number(arr[i]);
    return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  }) as Vec3;
}

function hex(value: unknown): string {
  const s = String(value ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + [...s.slice(1)].map((c) => c + c).join('')).toLowerCase();
  return '#9a9aa2';
}

const str = (v: unknown, fallback: string, max: number) => ((typeof v === 'string' && v.trim()) || fallback).slice(0, max);

/** Validates untrusted model output; unknown enums fall back to safe defaults. */
export function sanitizeLayout(raw: unknown): LayoutDesign {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawParts = Array.isArray(obj.parts) ? obj.parts.slice(0, MAX_PARTS) : [];
  const seen = new Set<string>();
  const parts: LayoutPart[] = rawParts
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p, i) => {
      // Names must be unique so later parts can refer to them.
      let name = str(p.name, `part ${i + 1}`, 40);
      while (seen.has(name)) name = `${name} ${i + 1}`;
      seen.add(name);
      return {
        name,
        shape: oneOf(PART_SHAPES, p.shape, 'box'),
        size: vec(p.size, 0.1, 0.002, 50),
        rotation: vec(p.rotation, 0, -360, 360),
        color: hex(p.color),
        material: oneOf(PART_MATERIALS, p.material, 'plastic'),
        attach_to: str(p.attach_to, 'ground', 40),
        side: oneOf(SIDES, p.side, i === 0 ? 'ground' : 'on_top'),
        align: oneOf(ALIGNS, p.align, 'center'),
        arrangement: oneOf(ARRANGEMENTS, p.arrangement, 'single'),
      };
    });
  if (parts.length === 0) throw new Error('The text model returned no parts.');

  // Small models sometimes repeat a multi-copy part ("corners" legs written four times).
  // A later part identical in shape, size and placement to an earlier repeated part is dropped.
  const key = (p: LayoutPart) => [p.shape, p.size.join(','), p.attach_to, p.side].join('|');
  const repeated = new Set<string>();
  const deduped = parts.filter((p) => {
    if (repeated.has(key(p))) return false;
    if (p.arrangement !== 'single') repeated.add(key(p));
    return true;
  });
  parts.splice(0, parts.length, ...deduped);

  return {
    name: str(obj.name, 'asset', 60),
    summary: str(obj.summary, '', 240),
    parts_plan: str(obj.parts_plan, '', 600),
    text_names_object: obj.text_names_object === undefined ? true : Boolean(obj.text_names_object),
    parts,
  };
}

interface Box {
  min: Vec3;
  max: Vec3;
}

const DEG = Math.PI / 180;

/** Half-extents of a box of `size` after rotating it (X, then Y, then Z). */
function rotatedHalfExtents(size: Vec3, rotation: Vec3): Vec3 {
  const [rx, ry, rz] = rotation.map((r) => r * DEG);
  const half = size.map((s) => s / 2);
  const out: Vec3 = [0, 0, 0];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        let [x, y, z] = [sx * half[0], sy * half[1], sz * half[2]];
        [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
        [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
        [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
        out[0] = Math.max(out[0], Math.abs(x));
        out[1] = Math.max(out[1], Math.abs(y));
        out[2] = Math.max(out[2], Math.abs(z));
      }
  return out;
}

const AXIS: Record<Exclude<Side, 'ground' | 'center'>, { axis: 0 | 1 | 2; dir: 1 | -1 }> = {
  on_top: { axis: 1, dir: 1 },
  below: { axis: 1, dir: -1 },
  right: { axis: 0, dir: 1 },
  left: { axis: 0, dir: -1 },
  front: { axis: 2, dir: 1 },
  back: { axis: 2, dir: -1 },
};

const ALIGN_AXIS: Record<Exclude<Align, 'center'>, { axis: 0 | 1 | 2; dir: 1 | -1 }> = {
  right: { axis: 0, dir: 1 },
  left: { axis: 0, dir: -1 },
  top: { axis: 1, dir: 1 },
  bottom: { axis: 1, dir: -1 },
  front: { axis: 2, dir: 1 },
  back: { axis: 2, dir: -1 },
};

/** Parts sink this far (fraction of their own extent) into what they attach to, so the object stays connected. */
const OVERLAP = 0.08;

/**
 * Resolves relative placements into absolute part centers. Repeated parts
 * (pairs, corners, rings) are expanded into separate parts.
 */
export function layoutToBlueprint(design: LayoutDesign): Blueprint {
  const placed = new Map<string, Box>();
  const out: BlueprintPart[] = [];
  let last: Box | null = null;

  for (const [i, p] of design.parts.entries()) {
    const h = rotatedHalfExtents(p.size, p.rotation);
    const named = placed.get(p.attach_to);
    // Unknown references attach to the previous part rather than floating off on their own.
    const ref: Box | null = p.side === 'ground' || i === 0 ? null : (named ?? last);
    const side: Side = ref ? (p.side === 'ground' ? 'on_top' : p.side) : 'ground';

    const c: Vec3 = ref ? [0, 1, 2].map((k) => (ref.min[k] + ref.max[k]) / 2) as Vec3 : [0, h[1], 0];
    if (ref && side !== 'center' && side !== 'ground') {
      const { axis, dir } = AXIS[side];
      const edge = dir > 0 ? ref.max[axis] : ref.min[axis];
      c[axis] = edge + dir * h[axis] * (1 - 2 * OVERLAP);
    }
    if (ref && p.align !== 'center') {
      const { axis, dir } = ALIGN_AXIS[p.align];
      const sideAxis = side in AXIS ? AXIS[side as keyof typeof AXIS].axis : -1;
      if (axis !== sideAxis) c[axis] = (dir > 0 ? ref.max[axis] : ref.min[axis]) - dir * h[axis];
    }

    const offsets = arrangementOffsets(p.arrangement, h, ref, side);
    const union: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    offsets.forEach(([dx, dz], n) => {
      const center: Vec3 = [c[0] + dx, c[1], c[2] + dz];
      for (let k = 0; k < 3; k++) {
        union.min[k] = Math.min(union.min[k], center[k] - h[k]);
        union.max[k] = Math.max(union.max[k], center[k] + h[k]);
      }
      out.push({
        name: offsets.length > 1 ? `${p.name} ${n + 1}` : p.name,
        shape: p.shape,
        size: p.size,
        position: center,
        rotation: p.rotation,
        color: p.color,
        material: p.material,
      });
    });
    placed.set(p.name, union);
    last = union;
  }

  return {
    name: design.name,
    summary: design.summary,
    textNamesObject: design.text_names_object,
    parts: out.slice(0, MAX_PARTS * 2),
    layout: design,
  };
}

/** Horizontal offsets for repeated parts, spread across the face they attach to. */
function arrangementOffsets(arr: Arrangement, h: Vec3, ref: Box | null, side: Side): [number, number][] {
  const halfX = ref ? (ref.max[0] - ref.min[0]) / 2 : h[0] * 2;
  const halfZ = ref ? (ref.max[2] - ref.min[2]) / 2 : h[2] * 2;
  const inX = Math.max(halfX - h[0], h[0]);
  const inZ = Math.max(halfZ - h[2], h[2]);
  switch (arr) {
    case 'pair':
      // Side-mounted pairs (e.g. wheels on the left/right) spread front-to-back instead.
      return side === 'left' || side === 'right'
        ? [
            [0, -inZ],
            [0, inZ],
          ]
        : [
            [-inX, 0],
            [inX, 0],
          ];
    case 'corners':
      return [
        [-inX, -inZ],
        [inX, -inZ],
        [-inX, inZ],
        [inX, inZ],
      ];
    case 'ring3':
    case 'ring6': {
      const n = arr === 'ring3' ? 3 : 6;
      const r = Math.max(Math.min(inX, inZ), Math.max(h[0], h[2]));
      return Array.from({ length: n }, (_, i): [number, number] => {
        const t = (i / n) * Math.PI * 2;
        return [Math.sin(t) * r, Math.cos(t) * r];
      });
    }
    default:
      return [[0, 0]];
  }
}
