import { createCanvas, type Image } from '@napi-rs/canvas';
import type { Rgb } from '../types';
import type { Surface } from './promptParser';

/**
 * Local, model-free "understanding" of a reference image: separate the object
 * from its background, then measure its outline, symmetry, proportions and
 * color layout. Downstream code turns these measurements into a 3D form.
 */
export type Point = [number, number];

/**
 * A closed silhouette with optional holes. Coordinates are in units of the
 * object's height: x relative to the symmetry axis, y up from 0 (bottom) to 1.
 */
export interface Outline {
  outer: Point[];
  holes: Point[][];
}

export interface Appendage {
  outline: Outline;
  /** Palette index of the appendage's dominant color. */
  index: number;
  /** Estimated thickness (â‰ˆ stroke width) in units of object height. */
  thickness: number;
}

export interface ImageAnalysis {
  /** False when no single object could be separated from the background. */
  hasObject: boolean;
  /** 0..1, how cleanly the object separated from the background. */
  confidence: number;
  /** Object height / width. */
  aspect: number;
  /** Object area / bounding-box area (â‰ˆ1 for boxes, â‰ˆ0.785 for discs). */
  fill: number;
  /** IoU of the silhouette with its mirror image about the best vertical axis. */
  symmetry: number;
  /** 4Ï€A/PÂ², 1 for a perfect circle. */
  circularity: number;
  /** Fraction of the object that is mirror-symmetric about the axis (the "core"). */
  coreFraction: number;
  /** Core half-width per height, bottom (y=0) to top (y=1), in units of object height. */
  profile: { y: number; r: number }[];
  /** Every separate piece of the silhouette, with holes. */
  shapes: Outline[];
  /** Asymmetric pieces left over once the symmetric core is removed (handles, arms, spoutsâ€¦). */
  appendages: Appendage[];
  /** The object's bounding box in outline coordinates. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Dominant colors of the object, heaviest first. */
  palette: { color: Rgb; weight: number }[];
  /** Horizontal color bands of the core, bottom-up fractions of height, each an index into palette. */
  bands: { from: number; to: number; index: number }[];
  /** Coarse grid of palette indices over the bounding box (row 0 = top), 255 = empty. */
  regions: { cols: number; rows: number; cells: Uint8Array };
  surfaceGuess: Surface | null;
  /** Silhouette cropped to its bounding box (row 0 = top), 1 = object. Used to inflate it into 3D. */
  mask: { w: number; h: number; data: Uint8Array };
  /** Object area / convex hull area: ~1 for compact shapes, low for limbs and spikes. */
  solidity: number;
  /** How many sides of the bounding box touch the image border (a cropped object makes a poor reference). */
  edgeTouches: number;
  /** True when the silhouette came from a transparent PNG's alpha channel. */
  fromAlpha: boolean;
  /** Object area / image area. Near 1 means the "object" is really the whole scene. */
  areaFraction: number;
  /** Area of each separate piece as a fraction of the object, largest first. */
  pieceAreas: number[];
  /** Bounding box size as a fraction of the image ({1, 1} = spans the whole picture). */
  bboxCover: { w: number; h: number };
}

const SIZE = 128;
const EMPTY = 255;

type Mask = Uint8Array;

interface Pixels {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export function analyzeImage(img: Image): ImageAnalysis {
  const scale = Math.min(1, SIZE / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const px: Pixels = { w, h, data: new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data) };

  const { mask, confidence, fromAlpha } = segment(px);
  const area = count(mask);
  if (area < w * h * 0.02 || area > w * h * 0.97) return colorsOnly(px, confidence * 0.3);

  const box = bounds(mask, w, h);
  const cropped = new Uint8Array(box.w * box.h);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) cropped[y * box.w + x] = mask[(box.y + y) * w + box.x + x];
  const edgeTouches = [box.x === 0, box.y === 0, box.x + box.w === w, box.y + box.h === h].filter(Boolean).length;
  const { axis2, iou } = bestAxis(mask, w, box, area);
  const axis = axis2 / 2;
  const toLocal = ([x, y]: Point): Point => [(x - axis) / box.h, (box.y + box.h - 0.5 - y) / box.h];

  const pieces = components(mask, w, h);
  const shapes = pieces.map((p) => outlineOf(p.mask, w, h, toLocal));
  const perimeter = contourLength(traceContour(pieces[0].mask, w, h));

  // The symmetric core is what overlaps its own mirror image; the rest are appendages.
  const core = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const mx = axis2 - x;
      core[y * w + x] = mask[y * w + x] && mx >= 0 && mx < w && mask[y * w + mx] ? 1 : 0;
    }
  const coreArea = count(core);

  const palette = kmeansPalette(px, mask);
  const labels = labelPixels(px, mask, palette);
  const coreLabels = labels.map((l, i) => (core[i] ? l : EMPTY));

  const remainder = mask.map((v, i) => (v && !core[i] ? 1 : 0));
  const appendages: Appendage[] = components(remainder, w, h, 0)
    .filter((c) => c.size >= area * 0.04)
    .map((c) => {
      const counts = new Array(palette.length).fill(0);
      for (let i = 0; i < c.mask.length; i++) if (c.mask[i] && labels[i] !== EMPTY) counts[labels[i]]++;
      const perim = contourLength(traceContour(c.mask, w, h));
      return {
        outline: outlineOf(c.mask, w, h, toLocal),
        index: counts.indexOf(Math.max(...counts)),
        thickness: Math.min(0.3, Math.max(0.04, (2 * c.size) / perim / box.h)),
      };
    });

  const [minX] = toLocal([box.x - 0.5, 0]);
  const [maxX] = toLocal([box.x + box.w - 0.5, 0]);

  return {
    hasObject: true,
    confidence,
    aspect: box.h / box.w,
    fill: area / (box.w * box.h),
    symmetry: iou,
    circularity: Math.min(1, (4 * Math.PI * pieces[0].size) / (perimeter * perimeter)),
    coreFraction: coreArea / area,
    profile: widthProfile(core, w, box, axis),
    shapes,
    appendages,
    bounds: { minX, maxX, minY: 0, maxY: 1 },
    palette,
    bands: colorBands(coreArea ? coreLabels : labels, w, box, palette.length),
    regions: regionGrid(labels, w, box),
    surfaceGuess: guessSurface(px, mask, palette[0]?.color),
    mask: { w: box.w, h: box.h, data: cropped },
    solidity: Math.min(1, area / Math.max(1, hullArea(maskPoints(mask, w, h)))),
    edgeTouches,
    fromAlpha,
    areaFraction: area / (w * h),
    pieceAreas: pieces.map((p) => p.size / area),
    bboxCover: { w: box.w / w, h: box.h / h },
  };
}

function maskPoints(m: Mask, w: number, h: number): Point[] {
  const pts: Point[] = [];
  // Row extremes are enough for the convex hull and keep it fast.
  for (let y = 0; y < h; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < w; x++) {
      if (m[y * w + x]) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left >= 0) pts.push([left, y], [right + 1, y], [left, y + 1], [right + 1, y + 1]);
  }
  return pts;
}

/** Area of the convex hull (Andrew's monotone chain). */
function hullArea(points: Point[]): number {
  if (points.length < 3) return 0;
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function colorsOnly(px: Pixels, confidence: number): ImageAnalysis {
  const all = new Uint8Array(px.w * px.h).fill(1);
  const palette = kmeansPalette(px, all);
  return {
    hasObject: false,
    confidence,
    aspect: px.h / px.w,
    fill: 1,
    symmetry: 0,
    circularity: 0,
    coreFraction: 0,
    profile: [],
    shapes: [],
    appendages: [],
    bounds: { minX: -0.5, maxX: 0.5, minY: 0, maxY: 1 },
    palette,
    bands: [],
    regions: { cols: 0, rows: 0, cells: new Uint8Array() },
    surfaceGuess: guessSurface(px, all, palette[0]?.color),
    mask: { w: 0, h: 0, data: new Uint8Array() },
    solidity: 0,
    edgeTouches: 4,
    fromAlpha: false,
    areaFraction: 1,
    pieceAreas: [1],
    bboxCover: { w: 1, h: 1 },
  };
}

// ---------- Segmentation ----------

function colorAt(px: Pixels, i: number): Rgb {
  return [px.data[i * 4], px.data[i * 4 + 1], px.data[i * 4 + 2]];
}

function dist(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function segment(px: Pixels): { mask: Mask; confidence: number; fromAlpha: boolean } {
  const { w, h, data } = px;
  const n = w * h;

  // Transparent PNGs already tell us where the object is.
  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) transparent++;
  if (transparent > n * 0.05 && transparent < n * 0.97) {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    return { mask: keepMainPieces(clean(mask, w, h), w, h), confidence: 0.95, fromAlpha: true };
  }

  // Otherwise assume the border is background and flood-fill inward from it.
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const bg: Rgb = [0, 1, 2].map((c) => median(border.map((i) => data[i * 4 + c]))) as Rgb;

  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = dist(colorAt(px, i), bg);
  const borderNoise = percentile(border.map((i) => d[i]), 0.9);
  const threshold = Math.min(140, Math.max(26, borderNoise * 1.3, otsu(d) * 0.75));

  const isBg = new Uint8Array(n);
  const stack: number[] = [];
  for (const i of border) {
    if (d[i] < threshold && !isBg[i]) {
      isBg[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !isBg[j] && d[j] < threshold) {
        isBg[j] = 1;
        stack.push(j);
      }
    }
  }

  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = isBg[i] ? 0 : 1;

  // Background-colored pockets the flood fill couldn't reach (inside a mug handle,
  // between a chair's legs) are holes, not part of the object.
  const pockets = new Uint8Array(n);
  for (let i = 0; i < n; i++) pockets[i] = !isBg[i] && d[i] < threshold * 0.6 ? 1 : 0;
  for (const p of components(pockets, w, h, 0)) {
    if (p.size < n * 0.004) break;
    for (let i = 0; i < n; i++) if (p.mask[i]) raw[i] = 0;
  }

  const mask = keepMainPieces(clean(raw, w, h), w, h);

  // Confidence: how far object pixels sit from the background color, and how uniform the border was.
  let fgDist = 0;
  let fgCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      fgDist += d[i];
      fgCount++;
    }
  }
  const contrast = fgCount ? fgDist / fgCount / threshold : 0;
  const uniformity = 1 - Math.min(1, borderNoise / 120);
  const confidence = Math.max(0, Math.min(1, (contrast - 0.6) * 0.6 * uniformity + 0.25 * uniformity));
  return { mask, confidence, fromAlpha: false };
}

/** Close by 2px (bridges hairline gaps between parts) then open by 1px (removes specks). */
function clean(mask: Mask, w: number, h: number): Mask {
  let m = mask;
  m = dilate(dilate(m, w, h), w, h);
  m = erode(erode(m, w, h), w, h);
  return dilate(erode(m, w, h), w, h);
}

/** Keeps the largest piece plus any other piece at least 8% of its size (detached parts). */
function keepMainPieces(mask: Mask, w: number, h: number): Mask {
  const pieces = components(mask, w, h, 0);
  const out = new Uint8Array(mask.length);
  if (!pieces.length) return out;
  for (const p of pieces) {
    if (p.size < pieces[0].size * 0.08) break;
    for (let i = 0; i < out.length; i++) if (p.mask[i]) out[i] = 1;
  }
  return out;
}

function erode(m: Mask, w: number, h: number): Mask {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = m[i] && (x === 0 || m[i - 1]) && (x === w - 1 || m[i + 1]) && (y === 0 || m[i - w]) && (y === h - 1 || m[i + w]) ? 1 : 0;
    }
  return out;
}

function dilate(m: Mask, w: number, h: number): Mask {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) ? 1 : 0;
    }
  return out;
}

/** 4-connected components, largest first, each at least `minSize` pixels. */
function components(m: Mask, w: number, h: number, minSize = 1): { mask: Mask; size: number }[] {
  const label = new Int32Array(m.length).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && m[j] && label[j] < 0) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return sizes
    .map((size, id) => ({ id, size }))
    .filter((c) => c.size >= minSize)
    .sort((a, b) => b.size - a.size)
    .map(({ id, size }) => ({ mask: Uint8Array.from(label, (l) => (l === id ? 1 : 0)), size }));
}

// ---------- Shape measurements ----------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function count(m: Mask): number {
  let c = 0;
  for (const v of m) c += v;
  return c;
}

function bounds(m: Mask, w: number, h: number): Box {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Finds the vertical mirror axis that best matches the silhouette to itself.
 * `axis2` is twice the axis column so half-pixel axes stay integral (x â†¦ axis2 - x).
 */
function bestAxis(m: Mask, w: number, box: Box, area: number): { axis2: number; iou: number } {
  let best = { axis2: 2 * box.x + box.w - 1, iou: 0 };
  const from = Math.round(2 * (box.x + box.w * 0.2));
  const to = Math.round(2 * (box.x + box.w * 0.8));
  for (let a2 = from; a2 <= to; a2++) {
    let inter = 0;
    for (let y = box.y; y < box.y + box.h; y++)
      for (let x = box.x; x < box.x + box.w; x++) {
        const mx = a2 - x;
        if (m[y * w + x] && mx >= 0 && mx < w && m[y * w + mx]) inter++;
      }
    // Mirroring preserves area, so union = 2Â·area âˆ’ intersection.
    const iou = inter / (2 * area - inter);
    if (iou > best.iou) best = { axis2: a2, iou };
  }
  return best;
}

/** Half-width of the core about the axis, sampled bottom to top. */
function widthProfile(core: Mask, w: number, box: Box, axis: number, samples = 28): { y: number; r: number }[] {
  const raw: { y: number; r: number }[] = [];
  for (let s = 0; s < samples; s++) {
    const row = Math.round(box.y + box.h - 1 - (s / (samples - 1)) * (box.h - 1));
    let r = 0;
    for (let x = box.x; x < box.x + box.w; x++) if (core[row * w + x]) r = Math.max(r, Math.abs(x - axis) + 0.5);
    raw.push({ y: s / (samples - 1), r: r / box.h });
  }
  // Light smoothing keeps pixel steps out of the revolved surface.
  return raw.map((p, i) => {
    const a = raw[Math.max(0, i - 1)].r;
    const b = raw[Math.min(raw.length - 1, i + 1)].r;
    return { y: p.y, r: (a + 2 * p.r + b) / 4 };
  });
}

// Directions clockwise in image space (y down): E, SE, S, SW, W, NW, N, NE.
const DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Moore-neighbor tracing of the outer boundary. */
function traceContour(m: Mask, w: number, h: number): [number, number][] {
  let start = -1;
  for (let i = 0; i < m.length && start < 0; i++) if (m[i]) start = i;
  const sx = start % w;
  const sy = (start - sx) / w;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;

  const contour: [number, number][] = [[sx, sy]];
  let x = sx;
  let y = sy;
  let dir = 0;
  for (let step = 0; step < w * h * 4; step++) {
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      if (at(nx, ny)) {
        x = nx;
        y = ny;
        dir = d;
        moved = true;
        break;
      }
    }
    if (!moved || (x === sx && y === sy)) break;
    contour.push([x, y]);
  }
  return contour;
}

function contourLength(c: [number, number][]): number {
  let len = 0;
  for (let i = 0; i < c.length; i++) {
    const [ax, ay] = c[i];
    const [bx, by] = c[(i + 1) % c.length];
    len += Math.hypot(bx - ax, by - ay);
  }
  return Math.max(len, 1);
}

/** Ramerâ€“Douglasâ€“Peucker on a closed ring. */
function simplifyClosed(pts: [number, number][], epsilon: number): [number, number][] {
  if (pts.length < 8) return pts;
  let far = 0;
  let farDist = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), epsilon);
  const b = rdp([...pts.slice(far), pts[0]], epsilon);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let idx = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/** Outer contour plus enclosed holes of one connected piece, in outline coordinates. */
function outlineOf(piece: Mask, w: number, h: number, toLocal: (p: Point) => Point): Outline {
  const outer = simplifyClosed(traceContour(piece, w, h), 0.9).map(toLocal);
  const inverse = piece.map((v) => (v ? 0 : 1));
  const holes: Point[][] = [];
  for (const c of components(inverse, w, h, 12)) {
    let touchesEdge = false;
    for (let x = 0; x < w && !touchesEdge; x++) touchesEdge = c.mask[x] === 1 || c.mask[(h - 1) * w + x] === 1;
    for (let y = 0; y < h && !touchesEdge; y++) touchesEdge = c.mask[y * w] === 1 || c.mask[y * w + w - 1] === 1;
    if (touchesEdge) continue;
    const ring = simplifyClosed(traceContour(c.mask, w, h), 0.9);
    if (ring.length >= 3) holes.push(ring.map(toLocal));
  }
  return { outer, holes };
}

// ---------- Color ----------

/**
 * Distance that mostly ignores brightness, so the lit and shadowed sides of one
 * material cluster together instead of becoming separate "colors".
 */
function shadeTolerantDist(a: Rgb, b: Rgb): number {
  const sa = a[0] + a[1] + a[2] + 1;
  const sb = b[0] + b[1] + b[2] + 1;
  // Chromaticity (r:g:b ratios) is unchanged by lighting; it gets unreliable in near-black pixels.
  const dc = Math.hypot(a[0] / sa - b[0] / sb, a[1] / sa - b[1] / sb, a[2] / sa - b[2] / sb) * 380;
  const reliability = Math.min(1, Math.min(sa, sb) / 120);
  return Math.hypot(dc * reliability, ((sa - sb) / 3) * 0.35);
}

function kmeansPalette(px: Pixels, mask: Mask, k = 5): { color: Rgb; weight: number }[] {
  const samples: Rgb[] = [];
  const stride = Math.max(1, Math.floor(count(mask) / 4000));
  let seen = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && seen++ % stride === 0) samples.push(colorAt(px, i));
  if (samples.length === 0) return [];

  // Farthest-point initialization (deterministic).
  const centers: Rgb[] = [mean(samples)];
  while (centers.length < Math.min(k, samples.length)) {
    let best = samples[0];
    let bestD = -1;
    for (const s of samples) {
      const d = Math.min(...centers.map((c) => shadeTolerantDist(s, c)));
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    if (bestD < 12) break;
    centers.push(best);
  }

  let assign = new Array<number>(samples.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    assign = samples.map((s) => nearest(s, centers));
    for (let c = 0; c < centers.length; c++) {
      const members = samples.filter((_, i) => assign[i] === c);
      if (members.length) centers[c] = mean(members);
    }
  }

  let clusters = centers.map((color, c) => ({ color, weight: assign.filter((a) => a === c).length / samples.length }));
  // Merge near-duplicates, drop tiny clusters.
  clusters.sort((a, b) => b.weight - a.weight);
  const merged: typeof clusters = [];
  for (const cl of clusters) {
    // Highlights desaturate a color (≈45 on this scale); distinct hues like red vs brown are 90+.
    const twin = merged.find((m) => shadeTolerantDist(m.color, cl.color) < 48);
    if (twin) twin.weight += cl.weight;
    else merged.push({ ...cl });
  }
  clusters = merged.filter((c) => c.weight >= 0.04).sort((a, b) => b.weight - a.weight);
  return clusters.map((c) => ({ color: c.color.map((v) => v / 255) as Rgb, weight: c.weight }));
}

function labelPixels(px: Pixels, mask: Mask, palette: { color: Rgb }[]): Uint8Array {
  const centers = palette.map((p) => p.color.map((v) => v * 255) as Rgb);
  const labels = new Uint8Array(mask.length).fill(EMPTY);
  for (let i = 0; i < mask.length; i++) if (mask[i]) labels[i] = nearest(colorAt(px, i), centers);
  return labels;
}

function colorBands(labels: Uint8Array, w: number, box: Box, paletteSize: number) {
  // Dominant label per row, bottom-up.
  const rows: number[] = [];
  for (let y = box.y + box.h - 1; y >= box.y; y--) {
    const counts = new Array(paletteSize).fill(0);
    for (let x = box.x; x < box.x + box.w; x++) {
      const l = labels[y * w + x];
      if (l !== EMPTY) counts[l]++;
    }
    rows.push(counts.indexOf(Math.max(...counts)));
  }
  const smooth = rows.map((_, i) => mode(rows.slice(Math.max(0, i - 3), i + 4)));

  let runs: { from: number; to: number; index: number }[] = [];
  for (let i = 0; i < smooth.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.index === smooth[i]) last.to = i + 1;
    else runs.push({ from: i, to: i + 1, index: smooth[i] });
  }
  // Absorb slivers shorter than 8% of the height into their larger neighbor.
  const minLen = Math.max(2, smooth.length * 0.08);
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    const i = runs.findIndex((r) => r.to - r.from < minLen);
    if (i >= 0) {
      const prev = runs[i - 1];
      const next = runs[i + 1];
      const into = !prev ? next : !next ? prev : prev.to - prev.from >= next.to - next.from ? prev : next;
      into.from = Math.min(into.from, runs[i].from);
      into.to = Math.max(into.to, runs[i].to);
      runs.splice(i, 1);
      changed = true;
    }
    // Neighbors that ended up with the same color become one band.
    runs = runs.reduce<typeof runs>((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && last.index === r.index) last.to = r.to;
      else acc.push({ ...r });
      return acc;
    }, []);
  }
  return runs.map((r) => ({ from: r.from / smooth.length, to: r.to / smooth.length, index: r.index }));
}

function regionGrid(labels: Uint8Array, w: number, box: Box) {
  const rows = 24;
  const cols = Math.max(4, Math.min(48, Math.round((rows * box.w) / box.h)));
  const cells = new Uint8Array(cols * rows).fill(EMPTY);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const votes = new Map<number, number>();
      let filled = 0;
      let total = 0;
      for (let y = Math.floor(box.y + (r * box.h) / rows); y < Math.ceil(box.y + ((r + 1) * box.h) / rows); y++)
        for (let x = Math.floor(box.x + (c * box.w) / cols); x < Math.ceil(box.x + ((c + 1) * box.w) / cols); x++) {
          total++;
          const l = labels[y * w + x];
          if (l === EMPTY) continue;
          filled++;
          votes.set(l, (votes.get(l) ?? 0) + 1);
        }
      if (filled > total * 0.35) cells[r * cols + c] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  // One pass of majority filtering turns pixel noise into clean painted regions.
  const out = cells.slice();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (cells[r * cols + c] === EMPTY) continue;
      const near: number[] = [];
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const v = cells[(r + dr) * cols + (c + dc)];
          if (r + dr >= 0 && r + dr < rows && c + dc >= 0 && c + dc < cols && v !== EMPTY) near.push(v);
        }
      out[r * cols + c] = mode(near);
    }
  return { cols, rows, cells: out };
}

function guessSurface(px: Pixels, mask: Mask, primary: Rgb | undefined): Surface | null {
  if (!primary) return null;
  const [hue, sat, val] = rgbToHsv(primary);
  let sum = 0;
  let sumSq = 0;
  let bright = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const [r, g, b] = colorAt(px, i);
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    sum += l;
    sumSq += l * l;
    if (l > 0.92) bright++;
    n++;
  }
  if (!n) return null;
  const variance = sumSq / n - (sum / n) ** 2;
  if (hue >= 15 && hue <= 45 && sat > 0.3 && sat < 0.85 && val > 0.2 && val < 0.75) return 'wood';
  if (sat < 0.15 && bright / n > 0.03 && variance > 0.02) return 'metal';
  if (sat < 0.18 && val > 0.25 && val < 0.8 && variance > 0.006) return 'stone';
  return null;
}

// ---------- Small helpers ----------

function mean(list: Rgb[]): Rgb {
  const s = [0, 0, 0];
  for (const c of list) for (let i = 0; i < 3; i++) s[i] += c[i];
  return s.map((v) => v / list.length) as Rgb;
}

function nearest(c: Rgb, centers: Rgb[]): number {
  let best = 0;
  let bestD = Infinity;
  centers.forEach((p, i) => {
    const d = shadeTolerantDist(c, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function percentile(values: number[], p: number): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

/** Otsu threshold over a distance map (0..441). */
function otsu(d: Float32Array): number {
  const bins = 128;
  const max = 442;
  const hist = new Array(bins).fill(0);
  for (const v of d) hist[Math.min(bins - 1, Math.floor((v / max) * bins))]++;
  const total = d.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = i;
    }
  }
  return ((best + 0.5) / bins) * max;
}

export function rgbToHsv([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
