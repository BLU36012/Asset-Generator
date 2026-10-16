import earcut from 'earcut';

/** Procedural primitives. All are centered on the origin; compose them with transform(). */

export interface Geometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

type Vec3 = [number, number, number];

function empty(): Geometry {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

export function box(w: number, h: number, d: number): Geometry {
  const g = empty();
  const half: Vec3 = [w / 2, h / 2, d / 2];
  // Each face: outward normal n plus in-plane axes u, v with u × v = n so the
  // corner order below winds counter-clockwise when viewed from outside.
  const faces: { n: Vec3; u: Vec3; v: Vec3 }[] = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const extent = (a: Vec3) => Math.abs(a[0]) * half[0] + Math.abs(a[1]) * half[1] + Math.abs(a[2]) * half[2];

  for (const { n, u, v } of faces) {
    const base = g.positions.length / 3;
    const eu = extent(u);
    const ev = extent(v);
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      for (let i = 0; i < 3; i++) g.positions.push(n[i] * half[i] + u[i] * su * eu + v[i] * sv * ev);
      g.normals.push(...n);
      g.uvs.push((su + 1) / 2, 1 - (sv + 1) / 2);
    }
    g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return g;
}

/** Truncated cone; rTop = 0 gives a cone. Spans y = -h/2 .. h/2. */
export function cylinder(rTop: number, rBottom: number, h: number, segments = 24, caps = true): Geometry {
  const g = empty();
  const slope = (rBottom - rTop) / h;

  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const sin = Math.sin(t);
    const cos = Math.cos(t);
    const len = Math.hypot(sin, slope, cos);
    for (const [r, y, v] of [
      [rBottom, -h / 2, 1],
      [rTop, h / 2, 0],
    ]) {
      g.positions.push(sin * r, y, cos * r);
      g.normals.push(sin / len, slope / len, cos / len);
      g.uvs.push(i / segments, v);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2; // bottom i
    const b = a + 2; // bottom i+1
    const c = b + 1; // top i+1
    const d = a + 1; // top i
    g.indices.push(a, b, c, a, c, d);
  }

  if (caps) {
    if (rTop > 0) addCap(g, rTop, h / 2, 1, segments);
    if (rBottom > 0) addCap(g, rBottom, -h / 2, -1, segments);
  }
  return g;
}

function addCap(g: Geometry, r: number, y: number, dir: 1 | -1, segments: number) {
  const center = g.positions.length / 3;
  g.positions.push(0, y, 0);
  g.normals.push(0, dir, 0);
  g.uvs.push(0.5, 0.5);
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x = Math.sin(t);
    const z = Math.cos(t);
    g.positions.push(x * r, y, z * r);
    g.normals.push(0, dir, 0);
    g.uvs.push(0.5 + x / 2, 0.5 - (z / 2) * dir);
  }
  for (let i = 0; i < segments; i++) {
    const p = center + 1 + i;
    if (dir === 1) g.indices.push(center, p, p + 1);
    else g.indices.push(center, p + 1, p);
  }
}

/** UV sphere. vFraction < 1 cuts it off below the top (0.5 = hemisphere, no bottom cap). */
export function sphere(r: number, wSeg = 24, hSeg = 16, vFraction = 1): Geometry {
  const g = empty();
  for (let y = 0; y <= hSeg; y++) {
    const v = y / hSeg;
    const phi = v * Math.PI * vFraction;
    for (let x = 0; x <= wSeg; x++) {
      const u = x / wSeg;
      const theta = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.sin(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.cos(theta);
      g.positions.push(nx * r, ny * r, nz * r);
      g.normals.push(nx, ny, nz);
      g.uvs.push(u, v);
    }
  }
  const row = wSeg + 1;
  for (let y = 0; y < hSeg; y++) {
    for (let x = 0; x < wSeg; x++) {
      const a = y * row + x;
      const b = a + row;
      g.indices.push(b, b + 1, a + 1, b, a + 1, a);
    }
  }
  return g;
}

/**
 * Surface of revolution from a bottom-to-top profile of (y, radius) pairs, with y
 * in 0..1 scaled by `height`. Caps close the ends when they have a radius. V runs
 * top (0) to bottom (1) so a band texture lines up with the source image.
 */
export function lathe(profile: { y: number; r: number }[], height: number, segments = 40): Geometry {
  const g = empty();
  const n = profile.length;
  const row = segments + 1;
  for (let i = 0; i < n; i++) {
    const prev = profile[Math.max(0, i - 1)];
    const next = profile[Math.min(n - 1, i + 1)];
    const dr = next.r - prev.r;
    const dy = (next.y - prev.y) * height;
    const len = Math.hypot(dr, dy) || 1;
    const [nr, ny] = len > 1e-9 ? [dy / len, -dr / len] : [1, 0];
    for (let j = 0; j <= segments; j++) {
      const t = (j / segments) * Math.PI * 2;
      g.positions.push(Math.sin(t) * profile[i].r, profile[i].y * height, Math.cos(t) * profile[i].r);
      g.normals.push(Math.sin(t) * nr, ny, Math.cos(t) * nr);
      g.uvs.push(j / segments, 1 - profile[i].y);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = b + row;
      const d = a + row;
      g.indices.push(a, b, c, a, c, d);
    }
  }
  const capRing = (p: { y: number; r: number }, dir: 1 | -1) => {
    if (p.r < 1e-3) return;
    const center = g.positions.length / 3;
    g.positions.push(0, p.y * height, 0);
    g.normals.push(0, dir, 0);
    g.uvs.push(0.5, 1 - p.y);
    for (let j = 0; j <= segments; j++) {
      const t = (j / segments) * Math.PI * 2;
      g.positions.push(Math.sin(t) * p.r, p.y * height, Math.cos(t) * p.r);
      g.normals.push(0, dir, 0);
      g.uvs.push(j / segments, 1 - p.y);
    }
    for (let j = 0; j < segments; j++) {
      const v = center + 1 + j;
      if (dir === 1) g.indices.push(center, v, v + 1);
      else g.indices.push(center, v + 1, v);
    }
  };
  capRing(profile[n - 1], 1);
  capRing(profile[0], -1);
  return g;
}

type Pt = [number, number];

export interface UvBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function ringArea(pts: Pt[]): number {
  return pts.reduce((s, [x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length];
    return s + x * ny - nx * y;
  }, 0);
}

/** Extrudes a simple polygon (x right, y up) into a slab facing +Z. */
export function extrudeOutline(points: Pt[], depth: number): Geometry {
  return extrudeShape({ outer: points, holes: [] }, depth);
}

/**
 * Extrudes a polygon with holes into a slab facing +Z. Caps are triangulated with
 * earcut; side normals are smoothed across shallow corners and kept sharp across
 * steep ones. UVs map `uvBounds` (default: the outer ring's box) to 0..1.
 */
export function extrudeShape(shape: { outer: Pt[]; holes: Pt[][] }, depth: number, uvBounds?: UvBounds): Geometry {
  // Outer ring counter-clockwise, holes clockwise: then (dy, -dx) always points out of the solid.
  const outer = ringArea(shape.outer) < 0 ? shape.outer.slice().reverse() : shape.outer.slice();
  const holes = shape.holes.filter((h) => h.length >= 3).map((h) => (ringArea(h) > 0 ? h.slice().reverse() : h.slice()));
  const rings = [outer, ...holes];
  const all = rings.flat();

  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const b = uvBounds ?? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const uv = (x: number, y: number) => [(x - b.minX) / (b.maxX - b.minX || 1), 1 - (y - b.minY) / (b.maxY - b.minY || 1)];

  const g = empty();
  const h = depth / 2;
  const holeStarts: number[] = [];
  let offset = outer.length;
  for (const hole of holes) {
    holeStarts.push(offset);
    offset += hole.length;
  }
  const tris = earcut(all.flat(), holeStarts);

  for (const side of [1, -1] as const) {
    const base = g.positions.length / 3;
    for (const [x, y] of all) {
      g.positions.push(x, y, side * h);
      g.normals.push(0, 0, side);
      g.uvs.push(...uv(x, y));
    }
    for (let t = 0; t < tris.length; t += 3) {
      let [p, q, r] = [tris[t], tris[t + 1], tris[t + 2]];
      const cross = (all[q][0] - all[p][0]) * (all[r][1] - all[p][1]) - (all[q][1] - all[p][1]) * (all[r][0] - all[p][0]);
      // Front faces wind counter-clockwise seen from +Z, back faces the opposite.
      if ((cross < 0) === (side === 1)) [q, r] = [r, q];
      g.indices.push(base + p, base + q, base + r);
    }
  }

  const smoothed = (a: Pt, c: Pt, own: Pt): Pt => {
    if (a[0] * c[0] + a[1] * c[1] < Math.cos((50 * Math.PI) / 180)) return own;
    const len = Math.hypot(a[0] + c[0], a[1] + c[1]) || 1;
    return [(a[0] + c[0]) / len, (a[1] + c[1]) / len];
  };

  for (const pts of rings) {
    const n = pts.length;
    const edges: Pt[] = pts.map(([x0, y0], i) => {
      const [x1, y1] = pts[(i + 1) % n];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      return [(y1 - y0) / len, -(x1 - x0) / len];
    });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = edges[i];
      const nStart = smoothed(edges[(i - 1 + n) % n], e, e);
      const nEnd = smoothed(e, edges[j], e);
      const base = g.positions.length / 3;
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[j];
      g.positions.push(x0, y0, h, x0, y0, -h, x1, y1, -h, x1, y1, h);
      g.normals.push(nStart[0], nStart[1], 0, nStart[0], nStart[1], 0, nEnd[0], nEnd[1], 0, nEnd[0], nEnd[1], 0);
      // Sample the texture at the rim so sides carry the edge colors.
      g.uvs.push(...uv(x0, y0), ...uv(x0, y0), ...uv(x1, y1), ...uv(x1, y1));
      g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return g;
}

export function bbox(g: Geometry): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], g.positions[i + k]);
      max[k] = Math.max(max[k], g.positions[i + k]);
    }
  }
  return { min, max };
}

/**
 * Inflates a silhouette (row 0 = top, 1 = inside) into a closed, rounded solid.
 * Each point's thickness follows a circular cross-section sized to the *local*
 * width of its limb (radius of the largest inscribed disk covering it), so arms
 * become thin tubes while a torso becomes a thick body. Output: x centered,
 * y up from 0 to 1 (units of silhouette height), z symmetric about 0. UVs map
 * the silhouette's bounding box to 0..1 (v = 0 at the top).
 */
export function inflateMask(mask: { w: number; h: number; data: Uint8Array }, thickness = 0.7, maxCells = 96): Geometry {
  // Downsample to a working grid with a one-cell empty border.
  const step = Math.max(1, Math.ceil(Math.max(mask.w, mask.h) / maxCells));
  const gw = Math.ceil(mask.w / step);
  const gh = Math.ceil(mask.h / step);
  const W = gw + 2;
  const H = gh + 2;
  const inside = new Uint8Array(W * H);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let on = 0;
      let total = 0;
      for (let y = gy * step; y < Math.min(mask.h, (gy + 1) * step); y++)
        for (let x = gx * step; x < Math.min(mask.w, (gx + 1) * step); x++) {
          on += mask.data[y * mask.w + x];
          total++;
        }
      inside[(gy + 1) * W + gx + 1] = on * 2 >= total ? 1 : 0;
    }

  // Chamfer distance to the outside (cell units).
  const dt = new Float32Array(W * H);
  for (let i = 0; i < dt.length; i++) dt[i] = inside[i] ? 1e9 : 0;
  const D = Math.SQRT2;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!inside[i]) continue;
      dt[i] = Math.min(dt[i], dt[i - 1] + 1, dt[i - W] + 1, dt[i - W - 1] + D, dt[i - W + 1] + D);
    }
  for (let y = H - 2; y >= 1; y--)
    for (let x = W - 2; x >= 1; x--) {
      const i = y * W + x;
      if (!inside[i]) continue;
      dt[i] = Math.min(dt[i], dt[i + 1] + 1, dt[i + W] + 1, dt[i + W + 1] + D, dt[i + W - 1] + D);
    }

  // Local limb radius: the largest inscribed disk that covers each cell.
  const ridge = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const r = dt[y * W + x];
      if (!r) continue;
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++)
        for (let dx = -ri; dx <= ri; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= H || xx < 0 || xx >= W || dx * dx + dy * dy >= r * r) continue;
          const j = yy * W + xx;
          if (inside[j] && ridge[j] < r) ridge[j] = r;
        }
    }
  const cellZ = new Float32Array(W * H);
  for (let i = 0; i < cellZ.length; i++) {
    if (!inside[i]) continue;
    const d = dt[i] - 0.5;
    cellZ[i] = Math.sqrt(Math.max(0, d * (2 * ridge[i] - d)));
  }

  // Vertices live on cell corners. Corners on the outline get z = 0 and are shared
  // by the front and back surfaces, which makes the mesh closed.
  const CW = W + 1;
  const cornerCells = (cx: number, cy: number) => [
    (cy - 1) * W + cx - 1,
    (cy - 1) * W + cx,
    cy * W + cx - 1,
    cy * W + cx,
  ];
  const front = new Int32Array(CW * (H + 1)).fill(-1);
  const back = new Int32Array(CW * (H + 1)).fill(-1);
  const boundary = new Uint8Array(CW * (H + 1));
  const g = empty();
  const unit = 1 / gh;
  for (let cy = 1; cy < H; cy++)
    for (let cx = 1; cx < W; cx++) {
      const cells = cornerCells(cx, cy);
      const n = cells.reduce((s, c) => s + inside[c], 0);
      if (!n) continue;
      const ci = cy * CW + cx;
      const z = n === 4 ? (cells.reduce((s, c) => s + cellZ[c], 0) / 4) * unit * thickness : 0;
      const x = (cx - 1 - gw / 2) * unit;
      const y = (gh + 1 - cy) * unit;
      const uv = [(cx - 1) / gw, (cy - 1) / gh];
      front[ci] = g.positions.length / 3;
      g.positions.push(x, y, z);
      g.uvs.push(...uv);
      if (n === 4) {
        back[ci] = g.positions.length / 3;
        g.positions.push(x, y, -z);
        g.uvs.push(...uv);
      } else {
        back[ci] = front[ci];
        boundary[ci] = 1;
      }
    }

  for (let py = 1; py < H - 1; py++)
    for (let px = 1; px < W - 1; px++) {
      if (!inside[py * W + px]) continue;
      // Corners of this cell in world terms: a top-left, b top-right, c bottom-right, d bottom-left.
      const a = py * CW + px;
      const b = a + 1;
      const c = (py + 1) * CW + px + 1;
      const d = (py + 1) * CW + px;
      if (boundary[a] && boundary[b] && boundary[c] && boundary[d]) {
        // A one-cell-thin spot has no depth; one face is enough.
        g.indices.push(front[d], front[c], front[b], front[d], front[b], front[a]);
        continue;
      }
      // Split along the diagonal that isn't shared by front and back (both ends on the outline),
      // so every edge belongs to exactly two triangles.
      if (boundary[b] && boundary[d]) {
        g.indices.push(front[a], front[d], front[c], front[a], front[c], front[b]);
        g.indices.push(back[a], back[c], back[d], back[a], back[b], back[c]);
      } else {
        g.indices.push(front[d], front[c], front[b], front[d], front[b], front[a]);
        g.indices.push(back[d], back[b], back[c], back[d], back[a], back[b]);
      }
    }

  smoothOutline(g, inside, W, H, front, boundary);
  g.normals = vertexNormals(g);
  return g;
}

/** Taubin-smooths the outline corners along outline edges to remove pixel stair-steps without shrinking. */
function smoothOutline(g: Geometry, inside: Uint8Array, W: number, H: number, front: Int32Array, boundary: Uint8Array) {
  const CW = W + 1;
  const neighbors = new Map<number, number[]>();
  const link = (p: number, q: number) => {
    if (!boundary[p] || !boundary[q]) return;
    neighbors.set(p, [...(neighbors.get(p) ?? []), q]);
    neighbors.set(q, [...(neighbors.get(q) ?? []), p]);
  };
  for (let cy = 1; cy < H; cy++)
    for (let cx = 1; cx < W; cx++) {
      // Horizontal edge (cx,cy)-(cx+1,cy) separates the cells above and below it.
      if (cx + 1 < W + 1 && inside[(cy - 1) * W + cx] !== inside[cy * W + cx]) link(cy * CW + cx, cy * CW + cx + 1);
      // Vertical edge (cx,cy)-(cx,cy+1) separates the cells left and right of it.
      if (cy + 1 < H + 1 && inside[cy * W + cx - 1] !== inside[cy * W + cx]) link(cy * CW + cx, (cy + 1) * CW + cx);
    }
  const corners = [...neighbors.keys()];
  for (let iter = 0; iter < 4; iter++) {
    for (const factor of [0.5, -0.53]) {
      const moves = corners.map((ci) => {
        const ns = neighbors.get(ci)!;
        const v = front[ci] * 3;
        const ax = ns.reduce((s, n) => s + g.positions[front[n] * 3], 0) / ns.length;
        const ay = ns.reduce((s, n) => s + g.positions[front[n] * 3 + 1], 0) / ns.length;
        return [v, (ax - g.positions[v]) * factor, (ay - g.positions[v + 1]) * factor];
      });
      for (const [v, dx, dy] of moves) {
        g.positions[v] += dx;
        g.positions[v + 1] += dy;
      }
    }
  }
}

/** Smooth per-vertex normals from area-weighted face normals. */
function vertexNormals(g: Geometry): number[] {
  const n = new Array(g.positions.length).fill(0);
  const p = g.positions;
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = [g.indices[i] * 3, g.indices[i + 1] * 3, g.indices[i + 2] * 3];
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v + k] += f[k];
  }
  for (let v = 0; v < n.length; v += 3) {
    const len = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= len;
    n[v + 1] /= len;
    n[v + 2] /= len;
  }
  return n;
}

/** Ring lying flat in the XZ plane (hole axis = Y). `major` is the ring radius, `minor` the tube radius. */
export function torus(major: number, minor: number, radial = 28, tubular = 12): Geometry {
  const g = empty();
  for (let i = 0; i <= radial; i++) {
    const u = (i / radial) * Math.PI * 2;
    const dir: Vec3 = [Math.sin(u), 0, Math.cos(u)];
    for (let j = 0; j <= tubular; j++) {
      const v = (j / tubular) * Math.PI * 2;
      const n: Vec3 = [dir[0] * Math.cos(v), Math.sin(v), dir[2] * Math.cos(v)];
      g.positions.push(dir[0] * major + n[0] * minor, n[1] * minor, dir[2] * major + n[2] * minor);
      g.normals.push(...n);
      g.uvs.push(i / radial, j / tubular);
    }
  }
  const row = tubular + 1;
  for (let i = 0; i < radial; i++)
    for (let j = 0; j < tubular; j++) {
      const a = i * row + j;
      const b = a + row;
      g.indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  return g;
}

/** Pill along Y: total height `height`, radius `r`. */
export function capsule(r: number, height: number, segments = 20): Geometry {
  const body = Math.max(0, height - 2 * r);
  const cap = sphere(r, segments, Math.max(4, Math.round(segments / 3)), 0.5);
  return merge(
    cylinder(r, r, body || 1e-4, segments, false),
    transform(cap, { translate: [0, body / 2, 0] }),
    transform(cap, { rotate: [Math.PI, 0, 0], translate: [0, -body / 2, 0] }),
  );
}

/** Upper half of a unit sphere (diameter 1) with a flat base, centered on its bounding box. */
export function dome(segments = 24): Geometry {
  const g = empty();
  addCap(g, 0.5, 0, -1, segments);
  return transform(merge(sphere(0.5, segments, Math.max(4, Math.round(segments / 3)), 0.5), g), { translate: [0, -0.25, 0] });
}

/** Unit square-based pyramid (1×1×1), centered. */
export function pyramid(): Geometry {
  return flatShade(transform(cylinder(0, Math.SQRT1_2, 1, 4), { rotate: [0, Math.PI / 4, 0] }));
}

/** Unit ramp (1×1×1), full height at the back (-Z) sloping down to the front (+Z), centered. */
export function wedge(): Geometry {
  const v: Vec3[] = [
    [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5],
    [0.5, -0.5, 0.5],
    [-0.5, -0.5, 0.5],
    [-0.5, 0.5, -0.5],
    [0.5, 0.5, -0.5],
  ];
  const tris = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 1, 5],
    [0, 5, 4],
    [3, 2, 5],
    [3, 5, 4],
    [0, 3, 4],
    [1, 2, 5],
  ];
  return convexSolid(v, tris);
}

/** Builds a flat-shaded convex solid, orienting every triangle to face away from the center. */
function convexSolid(v: Vec3[], tris: number[][]): Geometry {
  const center = [0, 1, 2].map((k) => v.reduce((s, p) => s + p[k], 0) / v.length);
  const g = empty();
  for (const t of tris) {
    let [a, b, c] = t.map((i) => v[i]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const out = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3 - center[k]);
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      g.positions.push(...p);
      g.normals.push(0, 0, 0);
      g.uvs.push(p[0] + 0.5, 0.5 - p[1]);
    }
  }
  g.indices = Array.from({ length: g.positions.length / 3 }, (_, i) => i);
  return recomputeFlatNormals(g);
}

export function octahedron(r: number): Geometry {
  const p: Vec3[] = [
    [r, 0, 0],
    [-r, 0, 0],
    [0, r, 0],
    [0, -r, 0],
    [0, 0, r],
    [0, 0, -r],
  ];
  const faces = [
    [4, 0, 2],
    [0, 5, 2],
    [5, 1, 2],
    [1, 4, 2],
    [0, 4, 3],
    [5, 0, 3],
    [1, 5, 3],
    [4, 1, 3],
  ];
  const g = empty();
  for (const f of faces) for (const i of f) g.positions.push(...p[i]);
  g.indices = Array.from({ length: g.positions.length / 3 }, (_, i) => i);
  g.normals = new Array(g.positions.length).fill(0);
  g.uvs = [];
  for (let i = 0; i < faces.length; i++) g.uvs.push(0.5, 0, 0, 1, 1, 1);
  return recomputeFlatNormals(g);
}

/** Moves every vertex along its normal by f(direction); used for lumpy rocks. */
export function displace(g: Geometry, f: (x: number, y: number, z: number) => number): Geometry {
  const positions = g.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    const len = Math.hypot(positions[i], positions[i + 1], positions[i + 2]) || 1;
    const k = f(positions[i] / len, positions[i + 1] / len, positions[i + 2] / len);
    positions[i] *= k;
    positions[i + 1] *= k;
    positions[i + 2] *= k;
  }
  return { ...g, positions };
}

/** Un-indexes the mesh so each triangle gets its own vertices and a face normal (low-poly look). */
export function flatShade(g: Geometry): Geometry {
  const out = empty();
  for (const idx of g.indices) {
    out.positions.push(g.positions[idx * 3], g.positions[idx * 3 + 1], g.positions[idx * 3 + 2]);
    out.uvs.push(g.uvs[idx * 2], g.uvs[idx * 2 + 1]);
    out.normals.push(0, 0, 0);
  }
  out.indices = Array.from({ length: g.indices.length }, (_, i) => i);
  return recomputeFlatNormals(out);
}

function recomputeFlatNormals(g: Geometry): Geometry {
  const p = g.positions;
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = [g.indices[i] * 3, g.indices[i + 1] * 3, g.indices[i + 2] * 3];
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const v of [a, b, c]) {
      g.normals[v] = n[0] / len;
      g.normals[v + 1] = n[1] / len;
      g.normals[v + 2] = n[2] / len;
    }
  }
  return g;
}

export interface Transform {
  scale?: Vec3;
  /** Euler angles in radians, applied X then Y then Z. */
  rotate?: Vec3;
  translate?: Vec3;
}

export function transform(g: Geometry, t: Transform): Geometry {
  const [sx, sy, sz] = t.scale ?? [1, 1, 1];
  const [rx, ry, rz] = t.rotate ?? [0, 0, 0];
  const [tx, ty, tz] = t.translate ?? [0, 0, 0];

  const rot = (v: Vec3): Vec3 => {
    let [x, y, z] = v;
    if (rx) [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    if (ry) [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    if (rz) [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    return [x, y, z];
  };

  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < g.positions.length; i += 3) {
    const p = rot([g.positions[i] * sx, g.positions[i + 1] * sy, g.positions[i + 2] * sz]);
    positions.push(p[0] + tx, p[1] + ty, p[2] + tz);
    // Normals transform by the inverse-transpose of the scale.
    const n = rot([g.normals[i] / sx, g.normals[i + 1] / sy, g.normals[i + 2] / sz]);
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    normals.push(n[0] / len, n[1] / len, n[2] / len);
  }
  // A negative scale mirrors the mesh, so flip the winding to keep faces outward.
  const mirrored = sx * sy * sz < 0;
  const indices = mirrored ? flipWinding(g.indices) : g.indices.slice();
  return { positions, normals, uvs: g.uvs.slice(), indices };
}

function flipWinding(indices: number[]): number[] {
  const out = indices.slice();
  for (let i = 0; i < out.length; i += 3) [out[i + 1], out[i + 2]] = [out[i + 2], out[i + 1]];
  return out;
}

export function merge(...geos: Geometry[]): Geometry {
  const out = empty();
  for (const g of geos) {
    const offset = out.positions.length / 3;
    out.positions.push(...g.positions);
    out.normals.push(...g.normals);
    out.uvs.push(...g.uvs);
    out.indices.push(...g.indices.map((i) => i + offset));
  }
  return out;
}
