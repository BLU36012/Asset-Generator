import { hexToRgb, type Blueprint, type BlueprintPart, type PartMaterial } from '../llm/blueprint';
import type { Rgb } from '../types';
import { box, capsule, cylinder, dome, pyramid, sphere, torus, transform, wedge, type Geometry } from './geometry';
import type { Modifiers } from './promptParser';

export const PART_PBR: Record<PartMaterial, { roughness: number; metallic: number }> = {
  metal: { roughness: 0.35, metallic: 0.9 },
  wood: { roughness: 0.8, metallic: 0 },
  stone: { roughness: 0.95, metallic: 0 },
  glass: { roughness: 0.08, metallic: 0 },
  plastic: { roughness: 0.45, metallic: 0 },
  fabric: { roughness: 0.95, metallic: 0 },
  organic: { roughness: 0.7, metallic: 0 },
  crystal: { roughness: 0.05, metallic: 0.1 },
  rubber: { roughness: 0.9, metallic: 0 },
  ceramic: { roughness: 0.25, metallic: 0 },
  glow: { roughness: 0.5, metallic: 0 },
};

export interface BuiltPart {
  part: BlueprintPart;
  geo: Geometry;
  color: Rgb;
  glow: boolean;
}

const RUST: Rgb = [0.55, 0.27, 0.1];
const MOSS: Rgb = [0.3, 0.5, 0.2];

/** Unit-size primitive for a part, scaled to its size (before rotation/position). */
function shapeGeometry(p: BlueprintPart, seg: (n: number) => number): Geometry {
  const [w, h, d] = p.size;
  switch (p.shape) {
    case 'box':
      return box(w, h, d);
    case 'sphere':
      return transform(sphere(0.5, seg(24), seg(16)), { scale: [w, h, d] });
    case 'cylinder':
      return transform(cylinder(0.5, 0.5, 1, seg(24)), { scale: [w, h, d] });
    case 'cone':
      return transform(cylinder(0, 0.5, 1, seg(24)), { scale: [w, h, d] });
    case 'torus': {
      const outer = Math.max(w, 1e-3) / 2;
      const minor = Math.min(Math.max(h / 2, outer * 0.04), outer * 0.48);
      return transform(torus(outer - minor, minor, seg(28), seg(12)), { scale: [1, 1, d / Math.max(w, 1e-3)] });
    }
    case 'capsule': {
      const r = Math.max(Math.min(w, d) / 2, 1e-3);
      return transform(capsule(r, Math.max(h, 2 * r), seg(20)), { scale: [w / (2 * r), 1, d / (2 * r)] });
    }
    case 'pyramid':
      return transform(pyramid(), { scale: [w, h, d] });
    case 'wedge':
      return transform(wedge(), { scale: [w, h, d] });
    case 'dome':
      return transform(dome(seg(24)), { scale: [w, h * 2, d] });
  }
}

const DEG = Math.PI / 180;

/** Places every part and resolves its final color (wear tints applied). */
export function buildBlueprintParts(bp: Blueprint, m: Modifiers): BuiltPart[] {
  const seg = (n: number) => (m.lowPoly ? Math.max(6, Math.round(n / 3)) : m.smooth ? n * 2 : n);
  return bp.parts.map((part) => {
    let color = hexToRgb(part.color);
    if (m.wear) {
      const tint = m.wear === 'rust' ? RUST : MOSS;
      color = color.map((c, i) => c * 0.7 + tint[i] * 0.3) as Rgb;
    }
    const geo = transform(shapeGeometry(part, seg), {
      rotate: [part.rotation[0] * DEG, part.rotation[1] * DEG, part.rotation[2] * DEG],
      translate: part.position,
    });
    return { part, geo, color, glow: part.material === 'glow' };
  });
}
