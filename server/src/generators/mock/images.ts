import { loadImage, type Canvas, type Image } from '@napi-rs/canvas';
import type { ImageFrame, InputImage } from '../types';

export function decodeImage(input: InputImage): Promise<Image> {
  return loadImage(input.data);
}

export function canvasToFrame(canvas: Canvas): ImageFrame {
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return { width, height, data: new Uint8ClampedArray(data) };
}
