import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { ImageFrame, Rgb, SpriteData } from '../types';
import type { Blueprint } from '../llm/blueprint';
import { buildBlueprintParts } from './blueprintMesh';
import { transform } from './geometry';
import { canvasToFrame } from './images';
import type { AssetSpec, Band, Form } from './interpret';
import { SHAPE_COLOR, SHAPE_SURFACE } from './mesh3d';
import { defaultSurfaceColor, mulberry32, shade, toCss, type Shape, type Surface } from './promptParser';
import { applyWear, bandCanvas, regionCanvas } from './textures';

export interface Build2DOptions {
  size: number;
  frameCount: number;
}

/** Drawing area in the -50..50 sprite space. */
const FIT = 84;

export function buildSprite(spec: AssetSpec, opts: Build2DOptions): SpriteData {
  const m = spec.modifiers;
  const form = spec.form;
  const preset = form.kind === 'preset' ? form.shape : null;
  const surface: Surface = spec.surface ?? (preset ? SHAPE_SURFACE[preset] : undefined) ?? 'plain';
  const primary: Rgb = spec.primary ?? (preset ? SHAPE_COLOR[preset] : undefined) ?? defaultSurfaceColor(surface, spec.seed);
  const S = opts.size;

  // Text proportions win; otherwise presets lean toward the image's aspect ratio.
  let sx = m.width ?? 1;
  let sy = m.height ?? 1;
  if (preset && spec.imageAspect && m.height === null && m.width === null) {
    sy *= Math.min(1.35, Math.max(0.75, Math.sqrt(spec.imageAspect)));
  }
  const norm = 1 / Math.max(sx, sy);
  sx *= norm;
  sy *= norm;

  // Image-derived art and blueprint projections are the same every frame, so prepare them once.
  const tris = form.kind === 'blueprint' ? projectBlueprint(form.blueprint, m) : null;
  const fill = form.kind === 'preset' || form.kind === 'blueprint' ? null : formFill(form, primary, surface, spec);

  const frames: ImageFrame[] = [];
  for (let f = 0; f < opts.frameCount; f++) {
    const t = opts.frameCount > 1 ? f / opts.frameCount : 0;
    const layer = createCanvas(S, S);
    const ctx = layer.getContext('2d');
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.scale(S / 100, S / 100); // draw in a -50..50 coordinate space

    if (opts.frameCount > 1) {
      const wave = Math.sin(t * Math.PI * 2);
      ctx.translate(0, -wave * 4);
      if (preset === 'coin') ctx.scale(Math.max(0.08, Math.abs(Math.cos(t * Math.PI))), 1);
      else ctx.scale(1 + wave * 0.03, 1 - wave * 0.03);
    }
    ctx.scale(sx, sy);

    if (preset) drawShape(ctx, preset, primary, spec.accent, mulberry32(spec.seed));
    else if (tris) drawTriangles(ctx, tris);
    else drawForm(ctx, form, fill!, primary);
    ctx.restore();
    applyWear(ctx, m.wear, S, mulberry32(spec.seed + 7));

    let out: Canvas = tris ? outlined(layer, 'rgba(10, 14, 26, 0.95)', Math.max(1, Math.round(S / 128))) : layer;
    if (m.glowing) {
      const base = out;
      out = createCanvas(S, S);
      const octx = out.getContext('2d');
      octx.shadowColor = toCss(shade(primary, 1.3), 0.95);
      octx.shadowBlur = S * 0.06;
      octx.drawImage(base, 0, 0);
      octx.drawImage(base, 0, 0);
    }
    frames.push(canvasToFrame(spec.pixelArt ? pixelate(out, 48) : out));
  }

  return { name: spec.name, summary: spec.notes.join('\n'), frames, fps: 8, generation: spec.generation };
}

// ---------- Blueprints: a tiny software renderer ----------

interface Tri {
  pts: [Pt, Pt, Pt];
  depth: number;
  color: string;
}

const VIEW_YAW = (-28 * Math.PI) / 180;
const VIEW_PITCH = (16 * Math.PI) / 180;
const LIGHT = (() => {
  const l = [-0.45, 0.75, 0.55];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

/** Projects every part into a three-quarter view, lights it, and returns depth-sorted triangles in sprite space. */
function projectBlueprint(bp: Blueprint, m: AssetSpec['modifiers']): Tri[] {
  const raw: { p: [number, number, number][]; depth: number; color: string }[] = [];
  for (const part of buildBlueprintParts(bp, m)) {
    const g = transform(transform(part.geo, { rotate: [0, VIEW_YAW, 0] }), { rotate: [VIEW_PITCH, 0, 0] });
    for (let i = 0; i < g.indices.length; i += 3) {
      const v = [g.indices[i], g.indices[i + 1], g.indices[i + 2]].map(
        (k) => [g.positions[k * 3], g.positions[k * 3 + 1], g.positions[k * 3 + 2]] as [number, number, number],
      );
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
      const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (len < 1e-12 || n[2] <= 0) continue; // degenerate or facing away from the camera (+z)
      const lambert = Math.max(0, (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / len);
      const light = part.glow ? 1.15 : 0.38 + 0.7 * lambert;
      raw.push({ p: v, depth: (v[0][2] + v[1][2] + v[2][2]) / 3, color: toCss(shade(part.color, light)) });
    }
  }
  if (!raw.length) return [];

  const xs = raw.flatMap((t) => t.p.map((p) => p[0]));
  const ys = raw.flatMap((t) => t.p.map((p) => p[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = FIT / Math.max(maxX - minX, maxY - minY, 1e-6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return raw
    .sort((a, b) => a.depth - b.depth)
    .map((t) => ({
      pts: t.p.map((p): Pt => [(p[0] - cx) * k, -(p[1] - cy) * k]) as [Pt, Pt, Pt],
      depth: t.depth,
      color: t.color,
    }));
}

function drawTriangles(ctx: SKRSContext2D, tris: Tri[]) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.6; // closes hairline seams between neighboring triangles
  for (const t of tris) {
    ctx.beginPath();
    ctx.moveTo(...t.pts[0]);
    ctx.lineTo(...t.pts[1]);
    ctx.lineTo(...t.pts[2]);
    ctx.closePath();
    ctx.fillStyle = t.color;
    ctx.strokeStyle = t.color;
    ctx.fill();
    ctx.stroke();
  }
}

/** Classic sprite outline: a dark silhouette drawn at 8 offsets behind the art. */
function outlined(src: Canvas, color: string, px: number): Canvas {
  const sil = createCanvas(src.width, src.height);
  const sctx = sil.getContext('2d');
  sctx.drawImage(src, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = color;
  sctx.fillRect(0, 0, src.width, src.height);
  const out = createCanvas(src.width, src.height);
  const octx = out.getContext('2d');
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    octx.drawImage(sil, dx * px, dy * px);
  }
  octx.drawImage(src, 0, 0);
  return out;
}

// ---------- Image-derived forms ----------

type Pt = [number, number];

interface Fill {
  /** Rings of the main body (outer contours and holes), filled even-odd. */
  rings: Pt[][];
  canvas: Canvas;
  bounds: { x: number; y: number; w: number; h: number };
  shading: 'round' | 'flat';
  /** Extra parts (handles, arms) drawn behind the body in a flat color. */
  parts: { rings: Pt[][]; color: Rgb }[];
}

/** Converts the inferred form into sprite-space rings plus the painted fill clipped inside them. */
function formFill(form: Exclude<Form, { kind: 'preset' | 'blueprint' }>, primary: Rgb, surface: Surface, spec: AssetSpec): Fill {
  // Object space: x relative to the axis, y up 0..1.
  let body: Pt[][];
  let bodyBox: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  const parts: { rings: Pt[][]; color: Rgb }[] = [];
  if (form.kind === 'revolve' || form.kind === 'composite') {
    const right = form.profile.map((p): Pt => [p.r, p.y]);
    const left = form.profile
      .slice()
      .reverse()
      .map((p): Pt => [-p.r, p.y]);
    body = [[...right, ...left]];
    if (form.kind === 'composite') {
      for (const a of form.appendages) parts.push({ rings: [a.outline.outer, ...a.outline.holes], color: a.color });
    }
  } else if (form.kind === 'box') {
    const w = 1 / form.aspect / 2;
    body = [
      [
        [-w, 0],
        [w, 0],
        [w, 1],
        [-w, 1],
      ],
    ];
  } else {
    // extrude and inflate both draw their silhouette with painted regions.
    body = form.shapes.flatMap((s) => [s.outer, ...s.holes]);
    bodyBox = form.bounds;
  }

  // Fit everything (body + parts) into the sprite frame, centered.
  const everything = [...body, ...parts.flatMap((p) => p.rings)].flat();
  const xs = everything.map((p) => p[0]);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const k = FIT / Math.max(maxX - minX, 1);
  const cx = (minX + maxX) / 2;
  const map = (rings: Pt[][]) => rings.map((r) => r.map(([x, y]): Pt => [(x - cx) * k, (0.5 - y) * k]));

  const rings = map(body);
  const box = bodyBox ?? (() => {
    const pts = body.flat();
    return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: 0, maxY: 1 };
  })();
  const bounds = { x: (box.minX - cx) * k, y: (0.5 - box.maxY) * k, w: (box.maxX - box.minX) * k, h: (box.maxY - box.minY) * k };

  const bands: Band[] = 'bands' in form && form.bands.length ? form.bands : [{ from: 0, to: 1, color: primary }];
  const canvas =
    form.kind === 'extrude' || form.kind === 'inflate' ? regionCanvas(form.regions, surface, spec.seed, 256) : bandCanvas(bands, surface, spec.seed, 256);
  return {
    rings,
    canvas,
    bounds,
    shading: form.kind === 'extrude' || form.kind === 'box' ? 'flat' : 'round',
    parts: parts.map((p) => ({ rings: map(p.rings), color: p.color })),
  };
}

function ringsPath(ctx: SKRSContext2D, rings: Pt[][]) {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  }
}

function drawForm(ctx: SKRSContext2D, _form: Form, fill: Fill, primary: Rgb) {
  for (const part of fill.parts) {
    ringsPath(ctx, part.rings);
    const g = ctx.createLinearGradient(-40, -40, 40, 40);
    g.addColorStop(0, toCss(shade(part.color, 1.2)));
    g.addColorStop(1, toCss(shade(part.color, 0.75)));
    ctx.fillStyle = g;
    ctx.fill('evenodd');
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = toCss(shade(part.color, 0.3));
    ctx.stroke();
  }

  const { rings, canvas, bounds } = fill;
  ringsPath(ctx, rings);
  ctx.save();
  ctx.clip('evenodd');
  ctx.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h);
  // Cel-style lighting: round forms get cylindrical shading, flat ones a top-left light.
  const g =
    fill.shading === 'round'
      ? ctx.createLinearGradient(bounds.x, 0, bounds.x + bounds.w, 0)
      : ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
  g.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
  g.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.restore();
  ringsPath(ctx, rings);
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = toCss(shade(primary, 0.3));
  ctx.stroke();
}

function pixelate(src: Canvas, cells: number): Canvas {
  const small = createCanvas(cells, cells);
  const sctx = small.getContext('2d');
  sctx.drawImage(src, 0, 0, cells, cells);
  const out = createCanvas(src.width, src.height);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, src.width, src.height);
  return out;
}

function polygon(ctx: SKRSContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/** Fills the current path with a top-left-lit gradient and a dark outline. */
function fillShaded(ctx: SKRSContext2D, c: Rgb, x0 = -40, y0 = -40, x1 = 40, y1 = 40) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, toCss(shade(c, 1.25)));
  g.addColorStop(1, toCss(shade(c, 0.75)));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = toCss(shade(c, 0.3));
  ctx.stroke();
}

function drawShape(ctx: SKRSContext2D, shape: Shape, c: Rgb, accent: Rgb | null, rand: () => number) {
  const outline = toCss(shade(c, 0.3));
  const acc = (fallback: Rgb) => accent ?? fallback;
  switch (shape) {
    case 'crate': {
      ctx.beginPath();
      ctx.rect(-35, -35, 70, 70);
      fillShaded(ctx, c);
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      for (const y of [-12, 12]) {
        ctx.beginPath();
        ctx.moveTo(-35, y);
        ctx.lineTo(35, y);
        ctx.stroke();
      }
      ctx.lineWidth = 5;
      ctx.strokeStyle = toCss(shade(c, 0.6));
      ctx.strokeRect(-32, -32, 64, 64);
      ctx.beginPath();
      ctx.moveTo(-30, 30);
      ctx.lineTo(30, -30);
      ctx.stroke();
      break;
    }
    case 'barrel': {
      ctx.beginPath();
      ctx.moveTo(-26, -38);
      ctx.quadraticCurveTo(-36, 0, -26, 38);
      ctx.lineTo(26, 38);
      ctx.quadraticCurveTo(36, 0, 26, -38);
      ctx.closePath();
      fillShaded(ctx, c);
      ctx.strokeStyle = toCss(acc([0.25, 0.25, 0.28]));
      ctx.lineWidth = 5;
      for (const y of [-24, 24]) {
        ctx.beginPath();
        ctx.moveTo(-31, y);
        ctx.lineTo(31, y);
        ctx.stroke();
      }
      break;
    }
    case 'orb': {
      ctx.beginPath();
      ctx.arc(0, 0, 36, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(-12, -14, 4, 0, 0, 38);
      g.addColorStop(0, toCss(shade(c, 1.6)));
      g.addColorStop(1, toCss(shade(c, 0.6)));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.ellipse(-13, -16, 9, 5, -0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cone':
      polygon(ctx, [
        [0, -40],
        [34, 38],
        [-34, 38],
      ]);
      fillShaded(ctx, c);
      break;
    case 'tree': {
      ctx.beginPath();
      ctx.rect(-7, 10, 14, 32);
      fillShaded(ctx, acc([0.45, 0.3, 0.16]));
      for (const [x, y, r] of [
        [-16, 2, 18],
        [16, 2, 18],
        [0, -10, 22],
        [-8, -26, 16],
        [10, -24, 15],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        fillShaded(ctx, c);
      }
      break;
    }
    case 'rock': {
      const pts: [number, number][] = [];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const r = 28 + rand() * 10;
        pts.push([Math.cos(t) * r * 1.15, Math.sin(t) * r * 0.8 + 6]);
      }
      polygon(ctx, pts);
      fillShaded(ctx, c);
      ctx.strokeStyle = toCss(shade(c, 0.55));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[1][0] * 0.4, pts[1][1] * 0.4);
      ctx.lineTo(pts[4][0] * 0.5, pts[4][1] * 0.5);
      ctx.lineTo(pts[6][0] * 0.3, pts[6][1] * 0.3);
      ctx.stroke();
      break;
    }
    case 'pillar': {
      ctx.beginPath();
      ctx.rect(-14, -32, 28, 64);
      fillShaded(ctx, c);
      for (const y of [-42, 32]) {
        ctx.beginPath();
        ctx.rect(-24, y, 48, 10);
        fillShaded(ctx, shade(c, 0.9));
      }
      break;
    }
    case 'coin': {
      ctx.beginPath();
      ctx.arc(0, 0, 36, 0, Math.PI * 2);
      fillShaded(ctx, c);
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = toCss(shade(c, 0.6));
      ctx.stroke();
      polygon(ctx, starPath(14, 6, 5));
      ctx.fillStyle = toCss(shade(c, 0.7));
      ctx.fill();
      break;
    }
    case 'gem': {
      const pts: [number, number][] = [
        [-30, -12],
        [-16, -30],
        [16, -30],
        [30, -12],
        [0, 38],
      ];
      polygon(ctx, pts);
      fillShaded(ctx, c);
      ctx.strokeStyle = toCss(shade(c, 0.55));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-30, -12);
      ctx.lineTo(30, -12);
      ctx.moveTo(-16, -30);
      ctx.lineTo(-8, -12);
      ctx.lineTo(0, 38);
      ctx.lineTo(8, -12);
      ctx.lineTo(16, -30);
      ctx.stroke();
      break;
    }
    case 'mushroom': {
      ctx.beginPath();
      ctx.rect(-10, -2, 20, 36);
      fillShaded(ctx, acc([0.93, 0.9, 0.82]));
      ctx.beginPath();
      ctx.moveTo(-38, 2);
      ctx.bezierCurveTo(-38, -44, 38, -44, 38, 2);
      ctx.closePath();
      fillShaded(ctx, c);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (const [x, y, r] of [
        [-18, -12, 5],
        [4, -24, 6],
        [20, -8, 4],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'house': {
      ctx.beginPath();
      ctx.rect(-30, -6, 60, 44);
      fillShaded(ctx, c);
      polygon(ctx, [
        [-38, -4],
        [0, -40],
        [38, -4],
      ]);
      fillShaded(ctx, acc([0.6, 0.18, 0.15]));
      ctx.beginPath();
      ctx.rect(-7, 14, 14, 24);
      fillShaded(ctx, [0.4, 0.26, 0.14]);
      ctx.beginPath();
      ctx.rect(14, 4, 11, 11);
      fillShaded(ctx, [0.6, 0.85, 1]);
      break;
    }
    case 'sword': {
      ctx.rotate(-Math.PI / 4);
      polygon(ctx, [
        [-4, 20],
        [-4, -34],
        [0, -44],
        [4, -34],
        [4, 20],
      ]);
      fillShaded(ctx, c);
      ctx.beginPath();
      ctx.rect(-14, 18, 28, 5);
      fillShaded(ctx, acc([0.9, 0.7, 0.2]));
      ctx.beginPath();
      ctx.rect(-3, 23, 6, 14);
      fillShaded(ctx, [0.4, 0.26, 0.14]);
      ctx.beginPath();
      ctx.arc(0, 40, 4, 0, Math.PI * 2);
      fillShaded(ctx, acc([0.9, 0.7, 0.2]));
      break;
    }
    case 'potion': {
      ctx.beginPath();
      ctx.arc(0, 12, 26, 0, Math.PI * 2);
      fillShaded(ctx, c);
      ctx.beginPath();
      ctx.rect(-8, -28, 16, 18);
      fillShaded(ctx, [0.75, 0.9, 0.95]);
      ctx.beginPath();
      ctx.rect(-10, -38, 20, 10);
      fillShaded(ctx, acc([0.45, 0.3, 0.16]));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(-10, 2, 5, 9, 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'star':
      polygon(ctx, starPath(40, 17, 5));
      fillShaded(ctx, c);
      break;
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(0, 36);
      ctx.bezierCurveTo(-46, 6, -36, -38, 0, -18);
      ctx.bezierCurveTo(36, -38, 46, 6, 0, 36);
      ctx.closePath();
      fillShaded(ctx, c);
      break;
    }
  }
}

function starPath(outer: number, inner: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const t = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    pts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return pts;
}
