import { useState, type DragEvent } from 'react';
import { MAX_PROMPT } from '@asset-gen/shared';
import { MAX_IMAGES, newKey, VIDEO_FRAMES, type InputItem } from '../lib/inputs';
import { extractVideoFrames } from '../lib/videoFrames';

interface Props {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  items: InputItem[];
  onItemsChange: (items: InputItem[]) => void;
  videoName: string | null;
  onVideoNameChange: (name: string | null) => void;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function InputPanel({ prompt, onPromptChange, items, onItemsChange, videoName, onVideoNameChange }: Props) {
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState<'image' | 'video' | null>(null);

  const images = items.filter((i) => i.kind === 'image');
  const frames = items.filter((i) => i.kind === 'frame');

  const addImages = (files: File[]) => {
    setError('');
    const valid = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (valid.length < files.length) setError('Only PNG, JPG and WebP images are supported.');
    const room = MAX_IMAGES - images.length;
    if (valid.length > room) setError(`You can add up to ${MAX_IMAGES} photos.`);
    const added: InputItem[] = valid.slice(0, Math.max(0, room)).map((f) => ({
      key: newKey(),
      kind: 'image',
      blob: f,
      fileName: f.name,
      previewUrl: URL.createObjectURL(f),
    }));
    // Photos go first so the generator treats them as the primary reference.
    onItemsChange([...images, ...added, ...frames]);
  };

  const addVideo = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('video/')) {
      setError('Please choose a video file (MP4, WebM or MOV).');
      return;
    }
    setExtracting(true);
    try {
      const blobs = await extractVideoFrames(file, VIDEO_FRAMES);
      const newFrames: InputItem[] = blobs.map((blob, i) => ({
        key: newKey(),
        kind: 'frame',
        blob,
        fileName: `${file.name.replace(/\.[^.]+$/, '')}-frame${i + 1}.jpg`,
        previewUrl: URL.createObjectURL(blob),
      }));
      onItemsChange([...images, ...newFrames]);
      onVideoNameChange(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that video.');
    } finally {
      setExtracting(false);
    }
  };

  const remove = (key: string) => onItemsChange(items.filter((i) => i.key !== key));
  const removeVideo = () => {
    onItemsChange(images);
    onVideoNameChange(null);
  };

  const dropProps = (kind: 'image' | 'video') => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(kind);
    },
    onDragLeave: () => setDragging(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(null);
      const files = Array.from(e.dataTransfer.files);
      if (kind === 'image') addImages(files);
      else void addVideo(files[0]);
    },
  });

  return (
    <div className="stack">
      <label className="field">
        <span className="field-label">Text prompt</span>
        <textarea
          value={prompt}
          maxLength={MAX_PROMPT}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="e.g. a small red wooden crate, a golden coin, a pixel heart…"
        />
      </label>

      <div>
        <span className="field-label">Photo and/or video</span>
        <div className="dropzones">
          <label className={`dropzone ${dragging === 'image' ? 'dragging' : ''}`} {...dropProps('image')}>
            <input
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              onChange={(e) => {
                addImages(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <strong>+ Add photos</strong>
            <span className="small muted">PNG, JPG, WebP · up to {MAX_IMAGES}</span>
          </label>
          <label className={`dropzone ${dragging === 'video' ? 'dragging' : ''}`} {...dropProps('video')}>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => {
                void addVideo(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <strong>{extracting ? 'Reading video…' : videoName ? 'Replace video' : '+ Add video'}</strong>
            <span className="small muted">{VIDEO_FRAMES} key frames are extracted</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {images.length > 0 && (
        <div className="thumbs" aria-label="Photos">
          {images.map((item) => (
            <div className="thumb" key={item.key}>
              <img src={item.previewUrl} alt={item.fileName} />
              <button type="button" aria-label={`Remove ${item.fileName}`} onClick={() => remove(item.key)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {frames.length > 0 && (
        <div>
          <div className="row small" style={{ marginBottom: 6 }}>
            <span>
              Video{videoName ? `: ${videoName}` : ''} ({frames.length} frames)
            </span>
            <button type="button" className="link-btn small" onClick={removeVideo}>
              Remove video
            </button>
          </div>
          <div className="thumbs" aria-label="Video frames">
            {frames.map((item, i) => (
              <div className="thumb" key={item.key}>
                <img src={item.previewUrl} alt={`Frame ${i + 1}`} />
                <span className="tag">#{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
