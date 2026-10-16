import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Rgb, TextureImage } from '../types';
import type { Band, Regions } from './interpret';
import { mulberry32, shade, toCss, type Modifiers, type Surface } from './promptParser';

type Wear = Modifiers['wear'];

export interface TextureOptions {
  /** Draw a plank frame around wood (crates/boxes). */
  framed?: boolean;
  wear?: Wear;
}

async function encode(canvas: Canvas): Promise<TextureImage> {
  return { png: await canvas.encode('png'), width: canvas.width, height: canvas.height };
}

/** Single-color texture with the surface's pattern painted in. */
export async function surfaceTexture(surface: Surface, color: Rgb, seed: number, size = 256, opts: TextureOptions = {}): Promise<TextureImage> {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = toCss(color);
  ctx.fillRect(0, 0, size, size);
  paintSurface(ctx, surface, color, size, mulberry32(seed), opts.framed ?? false);
  applyWear(ctx, opts.wear ?? null, size, mulberry32(seed + 7));
  return encode(canvas);
}

/** Horizontal color bands (bottom-up fractions) with the surface pattern overlaid; v=0 is the top. */
export function bandCanvas(bands: Band[], surface: Surface, seed: number, size = 256, wear: Wear = null): Canvas {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  for (const b of bands) {
    ctx.fillStyle = toCss(b.color);
    const top = Math.floor((1 - b.to) * size);
    ctx.fillRect(0, top, size, Math.ceil((b.to - b.from) * size) + 1);
  }
  overlayDetail(ctx, surface, seed, size, size);
  applyWear(ctx, wear, size, mulberry32(seed + 7));
  return canvas;
}

export function bandTexture(bands: Band[], surface: Surface, seed: number, wear: Wear = null): Promise<TextureImage> {
  return encode(bandCanvas(bands, surface, seed, 256, wear));
}

/**
 * Paints the coarse color-region grid into smooth, flat-colored regions (like a
 * hand-painted toy), then overlays the surface pattern.
 */
export function regionCanvas(regions: Regions, surface: Surface, seed: number, size = 256, wear: Wear = null): Canvas {
  const { cols, rows, cells, palette } = regions;
  const fallback = palette[0] ?? [0.6, 0.6, 0.6];

  const small = createCanvas(cols, rows);
  const sctx = small.getContext('2d');
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      // Empty cells (outside the silhouette) borrow the nearest painted cell so edges don't bleed dark.
      let idx = cells[r * cols + c];
      for (let radius = 1; idx === 255 && radius < Math.max(cols, rows); radius++) {
        for (let dr = -radius; dr <= radius && idx === 255; dr++)
          for (let dc = -radius; dc <= radius && idx === 255; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) idx = cells[rr * cols + cc];
          }
      }
      sctx.fillStyle = toCss(palette[idx] ?? fallback);
      sctx.fillRect(c, r, 1, 1);
    }

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, size, size);

  // Snap the smoothly-scaled image back to the palette for crisp, rounded region edges.
  const img = ctx.getImageData(0, 0, size, size);
  const pal = palette.length ? palette.map((p) => p.map((v) => v * 255)) : [fallback.map((v) => v * 255)];
  for (let i = 0; i < img.data.length; i += 4) {
    let best = pal[0];
    let bestD = Infinity;
    for (const p of pal) {
      const d = (img.data[i] - p[0]) ** 2 + (img.data[i + 1] - p[1]) ** 2 + (img.data[i + 2] - p[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    img.data[i] = best[0];
    img.data[i + 1] = best[1];
    img.data[i + 2] = best[2];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  overlayDetail(ctx, surface, seed, size, size);
  applyWear(ctx, wear, size, mulberry32(seed + 7));
  return canvas;
}

export function regionTexture(regions: Regions, surface: Surface, seed: number, wear: Wear = null): Promise<TextureImage> {
  return encode(regionCanvas(regions, surface, seed, 256, wear));
}

/** Draws the surface pattern in neutral gray and blends it over whatever colors are already there. */
export function overlayDetail(ctx: SKRSContext2D, surface: Surface, seed: number, w: number, h: number) {
  const gray: Rgb = [0.5, 0.5, 0.5];
  const size = Math.max(w, h);
  const detail = createCanvas(size, size);
  const dctx = detail.getContext('2d');
  dctx.fillStyle = toCss(gray);
  dctx.fillRect(0, 0, size, size);
  paintSurface(dctx, surface, gray, size, mulberry32(seed), false);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.8;
  ctx.drawImage(detail, 0, 0, w, h);
  ctx.restore();
}

/** Rust or moss blotches; drawn with source-atop so transparent sprite areas stay clear. */
export function applyWear(ctx: SKRSContext2D, wear: Wear, size: number, rand: () => number) {
  if (!wear) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const color: Rgb = wear === 'rust' ? [0.55, 0.25, 0.08] : [0.28, 0.5, 0.18];
  for (let i = 0; i < 60; i++) {
    const x = rand() * size;
    // Moss gathers near the top; rust anywhere.
    const y = wear === 'moss' ? rand() ** 2 * size * 0.7 : rand() * size;
    const r = size * (0.02 + rand() * 0.06);
    ctx.fillStyle = toCss(shade(color, 0.8 + rand() * 0.4), 0.35 + rand() * 0.3);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintSurface(ctx: SKRSContext2D, surface: Surface, color: Rgb, size: number, rand: () => number, framed: boolean) {
  switch (surface) {
    case 'wood':
      paintWood(ctx, color, size, rand, framed);
      break;
    case 'stone':
      paintStone(ctx, color, size, rand);
      break;
    case 'brick':
      paintBrick(ctx, color, size, rand);
      break;
    case 'metal':
      paintMetal(ctx, color, size, rand);
      break;
    case 'glass':
      paintGlass(ctx, color, size);
      break;
    default:
      paintNoise(ctx, color, size, rand);
  }
}

function paintWood(ctx: SKRSContext2D, color: Rgb, size: number, rand: () => number, framed: boolean) {
  const planks = 4;
  const ph = size / planks;
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = toCss(shade(color, 0.85 + rand() * 0.3));
    ctx.fillRect(0, i * ph, size, ph);
    ctx.strokeStyle = toCss(shade(color, 0.6), 0.35);
    ctx.lineWidth = 1.5;
    for (let g = 0; g < 5; g++) {
      const y0 = i * ph + rand() * ph;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const y = y0 + Math.sin(x / (20 + rand() * 4) + g) * 2.5;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = toCss(shade(color, 0.35));
    ctx.fillRect(0, i * ph, size, 3);
  }
  if (framed) {
    ctx.strokeStyle = toCss(shade(color, 0.55));
    ctx.lineWidth = size * 0.07;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth);
  }
}

function paintStone(ctx: SKRSContext2D, color: Rgb, size: number, rand: () => number) {
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = toCss(shade(color, 0.7 + rand() * 0.6), 0.5);
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 1 + rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = toCss(shade(color, 0.45), 0.7);
  ctx.lineWidth = 1.5;
  for (let c = 0; c < 4; c++) {
    let x = rand() * size;
    let y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rand() - 0.5) * 40;
      y += (rand() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function paintBrick(ctx: SKRSContext2D, color: Rgb, size: number, rand: () => number) {
  ctx.fillStyle = toCss(shade(color, 1.35));
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const bh = size / rows;
  const bw = size / 4;
  const gap = 3;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? bw / 2 : 0;
    for (let c = -1; c < 5; c++) {
      ctx.fillStyle = toCss(shade(color, 0.8 + rand() * 0.35));
      ctx.fillRect(c * bw + offset + gap / 2, r * bh + gap / 2, bw - gap, bh - gap);
    }
  }
}

function paintMetal(ctx: SKRSContext2D, color: Rgb, size: number, rand: () => number) {
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, toCss(shade(color, 1.2)));
  grad.addColorStop(0.5, toCss(color));
  grad.addColorStop(1, toCss(shade(color, 0.75)));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = toCss(shade(color, 0.8 + rand() * 0.4), 0.15);
    ctx.fillRect(0, y, size, 1);
  }
  ctx.fillStyle = toCss(shade(color, 0.5));
  const m = size * 0.08;
  for (const [x, y] of [
    [m, m],
    [size - m, m],
    [m, size - m],
    [size - m, size - m],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintGlass(ctx: SKRSContext2D, color: Rgb, size: number) {
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, toCss(shade(color, 1.3)));
  grad.addColorStop(1, toCss(shade(color, 0.7)));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.moveTo(size * 0.15, 0);
  ctx.lineTo(size * 0.3, 0);
  ctx.lineTo(size * 0.05, size);
  ctx.lineTo(-size * 0.1, size);
  ctx.closePath();
  ctx.fill();
}

function paintNoise(ctx: SKRSContext2D, color: Rgb, size: number, rand: () => number) {
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = toCss(shade(color, 0.85 + rand() * 0.3), 0.4);
    ctx.fillRect(rand() * size, rand() * size, 3, 3);
  }
}
