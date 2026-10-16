import { createCanvas } from '@napi-rs/canvas';
import type { ImageFrame } from '../generators/types';
import type { ExportedFile } from './util';
import { zip } from './zip';

function frameToCanvas(frame: ImageFrame) {
  const canvas = createCanvas(frame.width, frame.height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(frame.width, frame.height);
  imageData.data.set(frame.data);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export async function encodePng(frame: ImageFrame): Promise<Buffer> {
  return frameToCanvas(frame).encode('png');
}

export async function toPng(frame: ImageFrame, base: string): Promise<ExportedFile> {
  return { data: await encodePng(frame), fileName: `${base}.png`, mime: 'image/png' };
}

/** JPG has no alpha channel, so transparent pixels are flattened onto white. */
export async function toJpg(frame: ImageFrame, base: string): Promise<ExportedFile> {
  const canvas = createCanvas(frame.width, frame.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.drawImage(frameToCanvas(frame), 0, 0);
  return { data: await canvas.encode('jpeg', 92), fileName: `${base}.jpg`, mime: 'image/jpeg' };
}

/** Uncompressed 32-bit TGA, top-left origin, 8-bit alpha. */
export function encodeTga(frame: ImageFrame): Buffer {
  const { width, height, data } = frame;
  const out = Buffer.alloc(18 + width * height * 4);
  out[2] = 2; // uncompressed true-color
  out.writeUInt16LE(width, 12);
  out.writeUInt16LE(height, 14);
  out[16] = 32; // bits per pixel
  out[17] = 0x28; // 8 alpha bits + top-left origin
  for (let i = 0, o = 18; i < data.length; i += 4, o += 4) {
    out[o] = data[i + 2];
    out[o + 1] = data[i + 1];
    out[o + 2] = data[i];
    out[o + 3] = data[i + 3];
  }
  return out;
}

export function toTga(frame: ImageFrame, base: string): ExportedFile {
  return { data: encodeTga(frame), fileName: `${base}.tga`, mime: 'image/x-tga' };
}

export interface SheetLayout {
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
}

export function sheetLayout(frames: ImageFrame[]): SheetLayout {
  const columns = Math.min(4, frames.length);
  return {
    columns,
    rows: Math.ceil(frames.length / columns),
    frameWidth: frames[0].width,
    frameHeight: frames[0].height,
  };
}

export async function encodeSheet(frames: ImageFrame[]): Promise<Buffer> {
  const { columns, rows, frameWidth, frameHeight } = sheetLayout(frames);
  const sheet = createCanvas(columns * frameWidth, rows * frameHeight);
  const ctx = sheet.getContext('2d');
  frames.forEach((f, i) => ctx.drawImage(frameToCanvas(f), (i % columns) * frameWidth, Math.floor(i / columns) * frameHeight));
  return sheet.encode('png');
}

/** Grid sprite sheet PNG + JSON frame rectangles, zipped. */
export async function toSpriteSheet(frames: ImageFrame[], fps: number, base: string): Promise<ExportedFile> {
  const layout = sheetLayout(frames);
  const png = await encodeSheet(frames);
  const json = {
    image: `${base}_sheet.png`,
    frameWidth: layout.frameWidth,
    frameHeight: layout.frameHeight,
    columns: layout.columns,
    rows: layout.rows,
    frameCount: frames.length,
    fps,
    frames: frames.map((_, i) => ({
      index: i,
      x: (i % layout.columns) * layout.frameWidth,
      y: Math.floor(i / layout.columns) * layout.frameHeight,
      w: layout.frameWidth,
      h: layout.frameHeight,
      durationMs: Math.round(1000 / fps),
    })),
  };
  const data = await zip([
    { name: `${base}_sheet.png`, data: png },
    { name: `${base}_sheet.json`, data: JSON.stringify(json, null, 2) },
  ]);
  return { data, fileName: `${base}_spritesheet.zip`, mime: 'application/zip' };
}
