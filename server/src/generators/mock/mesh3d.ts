import type { MeshData, MeshMaterial, MeshPart, Rgb, TextureImage } from '../types';
import {
  bbox,
  box,
  cylinder,
  displace,
  extrudeOutline,
  extrudeShape,
  flatShade,
  inflateMask,
  lathe,
  merge,
  octahedron,
  sphere,
  transform,
  type Geometry,
} from './geometry';
import type { Blueprint } from '../llm/blueprint';
import { buildBlueprintParts, PART_PBR } from './blueprintMesh';
import type { AssetSpec, Band } from './interpret';
import { defaultSurfaceColor, mulberry32, type Shape, type Surface } from './promptParser';
import { bandTexture, regionTexture, surfaceTexture } from './textures';

/** Surface used when neither the text nor the image suggests one. */
export const SHAPE_SURFACE: Partial<Record<Shape, Surface>> = {
  crate: 'wood',
  barrel: 'wood',
  house: 'wood',
  rock: 'stone',
  pillar: 'stone',
  coin: 'metal',
  sword: 'metal',
  gem: 'glass',
  potion: 'glass',
};

/** Main color used when neither the text nor the image gives one. */
export const SHAPE_COLOR: Partial<Record<Shape, Rgb>> = {
  crate: [0.6, 0.4, 0.22],
  barrel: [0.55, 0.35, 0.2],
  tree: [0.2, 0.55, 0.22],
  mushroom: [0.85, 0.15, 0.15],
  coin: [0.95, 0.75, 0.2],
  gem: [0.2, 0.85, 0.95],
  potion: [0.6, 0.2, 0.85],
  star: [0.98, 0.8, 0.15],
  heart: [0.9, 0.1, 0.25],
};

const SURFACE_PBR: Record<Surface, { roughness: number; metallic: number }> = {
  wood: { roughness: 0.8, metallic: 0 },
  stone: { roughness: 0.95, metallic: 0 },
  brick: { roughness: 0.9, metallic: 0 },
  metal: { roughness: 0.35, metallic: 0.9 },
  glass: { roughness: 0.1, metallic: 0 },
  plain: { roughness: 0.6, metallic: 0 },
};

const BROWN: Rgb = [0.4, 0.26, 0.14];
const DARK_METAL: Rgb = [0.25, 0.25, 0.28];
const CREAM: Rgb = [0.93, 0.9, 0.82];

/** Image-derived forms are normalized so their largest dimension is this many meters. */
const IMAGE_FORM_SIZE = 1.2;

/** Collects geometry per material and flattens it into MeshParts at the end. */
class MeshBuilder {
  materials: MeshMaterial[] = [];
  private geos = new Map<number, Geometry[]>();

  material(m: MeshMaterial): number {
    this.materials.push(m);
    return this.materials.length - 1;
  }

  add(material: number, ...geos: Geometry[]) {
    const list = this.geos.get(material) ?? [];
    list.push(...geos);
    this.geos.set(material, list);
  }

  bounds() {
    return bbox(merge(...[...this.geos.values()].flat()));
  }

  build(opts: { scale: [number, number, number]; lowPoly: boolean }): MeshPart[] {
    const merged = [...this.geos.entries()].map(([material, list]) => {
      const geo = transform(merge(...list), { scale: opts.scale });
      return { material, geo: opts.lowPoly ? flatShade(geo) : geo };
    });
    // Pivot at the bottom-center so the asset sits on the ground in every engine.
    let minY = Infinity;
    for (const { geo } of merged) for (let i = 1; i < geo.positions.length; i += 3) minY = Math.min(minY, geo.positions[i]);
    return merged.map(({ material, geo }) => {
      const positions = geo.positions.map((v, i) => (i % 3 === 1 ? v - minY : v));
      return { name: this.materials[material].name, material, ...geo, positions };
    });
  }
}

export interface Build3DOptions {
  maxTextureSize: number;
}

/** Real-world sized blueprint objects are kept within these bounds (meters, largest dimension). */
const BLUEPRINT_MIN_SIZE = 0.02;
const BLUEPRINT_MAX_SIZE = 40;

function buildBlueprintMesh(spec: AssetSpec, bp: Blueprint): MeshData {
  const m = spec.modifiers;
  const built = buildBlueprintParts(bp, m);
  const anyGlow = built.some((p) => p.glow);
  const b = new MeshBuilder();
  const materials = new Map<string, number>();

  for (const p of built) {
    const key = `${p.part.material}|${p.color.join(',')}`;
    let index = materials.get(key);
    if (index === undefined) {
      const pbr = { ...PART_PBR[p.part.material] };
      if (m.finish === 'shiny') pbr.roughness = Math.min(pbr.roughness, 0.15);
      if (m.finish === 'matte') pbr.roughness = 0.95;
      // "glowing" in the text lights the whole object if the model didn't add glowing parts itself.
      const emissive = p.glow || (m.glowing && !anyGlow) ? p.color : undefined;
      index = b.material({ name: p.part.name, color: p.color, textured: false, ...pbr, ...(emissive ? { emissive } : {}) });
      materials.set(key, index);
    }
    b.add(index, p.geo);
  }

  const bounds = b.bounds();
  const maxDim = Math.max(...[0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]), 1e-6);
  const fit = Math.min(1, BLUEPRINT_MAX_SIZE / maxDim) * Math.max(1, BLUEPRINT_MIN_SIZE / maxDim);
  const k = fit * spec.scale;
  const parts = b.build({ scale: [k, k, k], lowPoly: m.lowPoly });
  return { name: spec.name, summary: spec.notes.join('\n'), parts, materials: b.materials, generation: spec.generation };
}

export async function buildMesh(spec: AssetSpec, opts: Build3DOptions): Promise<MeshData> {
  if (spec.form.kind === 'blueprint') return buildBlueprintMesh(spec, spec.form.blueprint);
  const m = spec.modifiers;
  const segments = (n: number) => (m.lowPoly ? Math.max(6, Math.round(n / 3)) : m.smooth ? n * 2 : n);
  const preset = spec.form.kind === 'preset' ? spec.form.shape : null;
  const surface: Surface = spec.surface ?? (preset ? SHAPE_SURFACE[preset] : undefined) ?? 'plain';
  const primary: Rgb = spec.primary ?? (preset ? SHAPE_COLOR[preset] : undefined) ?? defaultSurfaceColor(surface, spec.seed);
  const pbr = { ...SURFACE_PBR[surface] };
  if (m.finish === 'shiny') pbr.roughness = 0.15;
  if (m.finish === 'matte') pbr.roughness = 0.95;

  const b = new MeshBuilder();
  const main = b.material({
    name: 'main',
    color: [1, 1, 1],
    textured: true,
    ...pbr,
    ...(m.glowing ? { emissive: primary } : {}),
  });
  const accentMat = (name: string, fallback: Rgb, roughness = 0.7, metallic = 0) =>
    b.material({ name, color: spec.accent ?? fallback, textured: false, roughness, metallic });
  const solidMat = (name: string, color: Rgb, roughness = 0.7, metallic = 0) =>
    b.material({ name, color, textured: false, roughness, metallic });

  let texture: TextureImage;
  const form = spec.form;
  const solidBand = (c: Rgb): Band[] => [{ from: 0, to: 1, color: c }];

  if (form.kind === 'preset') {
    texture = await surfaceTexture(surface, primary, spec.seed, Math.min(256, opts.maxTextureSize), {
      framed: form.shape === 'crate',
      wear: m.wear,
    });
    buildPreset(b, form.shape, main, accentMat, solidMat, segments, spec);
  } else if (form.kind === 'revolve' || form.kind === 'composite') {
    texture = await bandTexture(form.bands.length ? form.bands : solidBand(primary), surface, spec.seed, m.wear);
    b.add(main, lathe(form.profile, 1, segments(40)));
    if (form.kind === 'composite') {
      form.appendages.forEach((a, i) => {
        const mat = solidMat(`part_${i + 1}`, a.color, pbr.roughness, pbr.metallic);
        b.add(mat, extrudeShape(a.outline, a.thickness * (m.thickness ?? 1)));
      });
    }
  } else if (form.kind === 'box') {
    const w = 1 / form.aspect;
    const depth = Math.min(w, 1) * 0.85 * (m.thickness ?? 1);
    texture =
      form.bands.length > 1
        ? await bandTexture(form.bands, surface, spec.seed, m.wear)
        : await surfaceTexture(surface, form.bands[0]?.color ?? primary, spec.seed, 256, { framed: surface === 'wood', wear: m.wear });
    b.add(main, transform(box(w, 1, depth), { translate: [0, 0.5, 0] }));
  } else if (form.kind === 'inflate') {
    texture = await regionTexture(form.regions, surface, spec.seed, m.wear);
    b.add(main, inflateMask(form.mask, (spec.inflateDepth ?? 0.7) * (m.thickness ?? 1)));
  } else {
    const depth = 0.22 * (m.thickness ?? 1);
    texture = await regionTexture(form.regions, surface, spec.seed, m.wear);
    for (const shape of form.shapes) b.add(main, extrudeShape(shape, depth, form.bounds));
  }

  // Proportions: text modifiers always win; otherwise a preset leans toward the photo's aspect.
  const sx = m.width ?? 1;
  let sy = m.height ?? 1;
  const bounds = b.bounds();
  const size: [number, number, number] = [0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]) as [number, number, number];
  if (form.kind === 'preset' && spec.imageAspect && m.height === null && m.width === null) {
    const current = size[1] / Math.max(size[0], size[2], 1e-6);
    sy *= Math.min(1.35, Math.max(0.75, Math.sqrt(spec.imageAspect / current)));
  }
  let k = spec.scale;
  if (form.kind !== 'preset') {
    // Known subjects get their real-world size (a person 1.75 m tall); others a neutral 1.2 m.
    const t = spec.targetSize;
    // "length" is the longest dimension in any direction (a guitar may stand upright, a rifle lie flat).
    const current = t?.dim === 'height' ? size[1] : Math.max(...size);
    k *= (t ? t.size : IMAGE_FORM_SIZE) / Math.max(current, 1e-6);
  }

  const parts = b.build({ scale: [sx * k, sy * k, sx * k], lowPoly: m.lowPoly });
  return { name: spec.name, summary: spec.notes.join('\n'), parts, materials: b.materials, texture, generation: spec.generation };
}

type MatFn = (name: string, color: Rgb, roughness?: number, metallic?: number) => number;

function buildPreset(b: MeshBuilder, shape: Shape, main: number, accent: MatFn, solid: MatFn, seg: (n: number) => number, spec: AssetSpec) {
  const rand = mulberry32(spec.seed);
  switch (shape) {
    case 'crate':
      b.add(main, transform(box(1, 1, 1), { translate: [0, 0.5, 0] }));
      break;
    case 'barrel': {
      b.add(main, transform(cylinder(0.4, 0.4, 1, seg(24)), { translate: [0, 0.5, 0] }));
      const band = accent('band', DARK_METAL, 0.4, 0.8);
      for (const y of [0.15, 0.85]) b.add(band, transform(cylinder(0.415, 0.415, 0.06, seg(24)), { translate: [0, y, 0] }));
      break;
    }
    case 'orb':
      b.add(main, sphere(0.5, seg(32), seg(20)));
      break;
    case 'cone':
      b.add(main, cylinder(0, 0.5, 1, seg(32)));
      break;
    case 'tree': {
      const trunk = accent('trunk', BROWN, 0.9);
      b.add(trunk, transform(cylinder(0.1, 0.14, 0.8, 12), { translate: [0, 0.4, 0] }));
      if (['oak', 'bush', 'round', 'leafy'].some((w) => spec.words.includes(w))) {
        b.add(main, transform(flatShade(sphere(0.6, 8, 6)), { translate: [0, 1.25, 0] }));
      } else {
        b.add(
          main,
          transform(flatShade(cylinder(0, 0.55, 0.8, 10)), { translate: [0, 1.0, 0] }),
          transform(flatShade(cylinder(0, 0.42, 0.7, 10)), { translate: [0, 1.45, 0] }),
          transform(flatShade(cylinder(0, 0.28, 0.55, 10)), { translate: [0, 1.85, 0] }),
        );
      }
      break;
    }
    case 'rock': {
      const [a, c, d] = [rand() * 6, rand() * 6, rand() * 6];
      const lumpy = displace(sphere(0.5, 9, 6), (x, y, z) =>
        1 + 0.22 * Math.sin(3 * x + a) * Math.sin(2.3 * y + c) * Math.sin(2.7 * z + d) + 0.08 * Math.sin(7 * x + 5 * z + a),
      );
      b.add(main, transform(flatShade(lumpy), { scale: [1.2, 0.75, 1] }));
      break;
    }
    case 'pillar':
      b.add(
        main,
        transform(box(0.8, 0.2, 0.8), { translate: [0, 0.1, 0] }),
        transform(cylinder(0.28, 0.3, 2, seg(20)), { translate: [0, 1.2, 0] }),
        transform(box(0.8, 0.2, 0.8), { translate: [0, 2.3, 0] }),
      );
      break;
    case 'coin':
      b.add(main, transform(cylinder(0.5, 0.5, 0.08 * (spec.modifiers.thickness ?? 1), seg(40)), { rotate: [Math.PI / 2, 0, 0] }));
      break;
    case 'gem':
      b.add(main, transform(octahedron(1), { scale: [0.45, 0.8, 0.45] }));
      break;
    case 'mushroom': {
      const stem = accent('stem', CREAM, 0.8);
      b.add(stem, transform(cylinder(0.13, 0.17, 0.5, seg(16)), { translate: [0, 0.25, 0] }));
      b.add(stem, transform(cylinder(0.45, 0.45, 0.02, seg(24)), { translate: [0, 0.45, 0] }));
      b.add(main, transform(sphere(0.45, seg(24), 8, 0.5), { scale: [1, 0.75, 1], translate: [0, 0.45, 0] }));
      break;
    }
    case 'house': {
      b.add(main, transform(box(1.2, 0.9, 1), { translate: [0, 0.45, 0] }));
      const roof = accent('roof', [0.6, 0.18, 0.15], 0.85);
      b.add(roof, transform(flatShade(cylinder(0, 0.95, 0.6, 4)), { rotate: [0, Math.PI / 4, 0], translate: [0, 1.2, 0] }));
      b.add(solid('door', BROWN, 0.9), transform(box(0.25, 0.45, 0.02), { translate: [0, 0.225, 0.51] }));
      const glass = solid('window', [0.6, 0.85, 1], 0.1);
      for (const x of [-0.38, 0.38]) b.add(glass, transform(box(0.22, 0.22, 0.02), { translate: [x, 0.55, 0.51] }));
      break;
    }
    case 'sword': {
      b.add(solid('grip', BROWN, 0.9), transform(cylinder(0.03, 0.03, 0.25, 12), { translate: [0, 0.18, 0] }));
      const guard = accent('guard', [0.9, 0.7, 0.2], 0.35, 0.9);
      b.add(guard, transform(sphere(0.05, 12, 8), { translate: [0, 0.03, 0] }));
      b.add(guard, transform(box(0.36, 0.06, 0.08), { translate: [0, 0.33, 0] }));
      b.add(main, transform(box(0.09, 1.0, 0.02), { translate: [0, 0.86, 0] }));
      b.add(main, transform(flatShade(cylinder(0, 0.0636, 0.12, 4)), { rotate: [0, Math.PI / 4, 0], scale: [1, 1, 0.22], translate: [0, 1.42, 0] }));
      break;
    }
    case 'potion': {
      b.add(main, transform(sphere(0.3, seg(24), seg(16)), { translate: [0, 0.3, 0] }));
      b.add(main, transform(cylinder(0.08, 0.1, 0.2, seg(16)), { translate: [0, 0.65, 0] }));
      b.add(accent('cork', BROWN, 0.9), transform(cylinder(0.1, 0.09, 0.08, 12), { translate: [0, 0.79, 0] }));
      break;
    }
    case 'star':
      b.add(main, extrudeOutline(starPoints(0.5, 0.22, 5), 0.15 * (spec.modifiers.thickness ?? 1)));
      break;
    case 'heart':
      b.add(main, extrudeOutline(heartPoints(0.5), 0.15 * (spec.modifiers.thickness ?? 1)));
      break;
  }
}

export function starPoints(outer: number, inner: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const t = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
    pts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return pts;
}

export function heartPoints(size: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([(x / 17) * size, ((y + 2) / 17) * size]);
  }
  return pts;
}
