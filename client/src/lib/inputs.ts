/** One image the generator will receive: a photo, or a frame pulled from a video. */
export interface InputItem {
  key: string;
  kind: 'image' | 'frame';
  previewUrl: string;
  /** Present until the item has been uploaded. */
  blob?: Blob;
  fileName: string;
  uploadId?: string;
}

export const MAX_IMAGES = 4;
export const VIDEO_FRAMES = 4;

let counter = 0;
export function newKey(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export function fromUploadId(id: string, kind: InputItem['kind'] = 'image'): InputItem {
  return { key: newKey(), kind, previewUrl: `/api/uploads/${id}`, fileName: id, uploadId: id };
}
