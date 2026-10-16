function waitFor(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('This video format could not be read by your browser. Try MP4 or WebM.'));
    };
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', fail, { once: true });
  });
}

/**
 * Pulls `count` evenly spaced JPEG frames out of a video in the browser, so the
 * server only ever deals with images (no ffmpeg needed).
 */
export async function extractVideoFrames(file: File, count = 4, maxSize = 1024): Promise<Blob[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await waitFor(video, 'loadeddata');

    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      // Some WebM files report Infinity until you seek past the end.
      video.currentTime = 1e7;
      await waitFor(video, 'seeked');
      duration = video.duration;
    }
    if (!Number.isFinite(duration) || duration <= 0) duration = 0;

    const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d')!;

    const frames: Blob[] = [];
    for (let i = 0; i < count; i++) {
      video.currentTime = (duration * (i + 0.5)) / count;
      await waitFor(video, 'seeked');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (blob) frames.push(blob);
    }
    if (frames.length === 0) throw new Error('No frames could be extracted from this video.');
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}
