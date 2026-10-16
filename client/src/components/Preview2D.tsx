import { useEffect, useState } from 'react';
import type { SpriteSheetMeta } from '@asset-gen/shared';

/** Shows a still sprite, or plays a sprite sheet frame-by-frame. */
export function Preview2D({ url, sheet }: { url: string; sheet: SpriteSheetMeta | null }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!sheet) return;
    setFrame(0);
    const id = window.setInterval(() => setFrame((f) => (f + 1) % sheet.frameCount), 1000 / sheet.fps);
    return () => window.clearInterval(id);
  }, [sheet, url]);

  if (!sheet) {
    return (
      <div className="sprite-stage checker">
        <img src={url} alt="Generated sprite" />
      </div>
    );
  }

  const col = frame % sheet.columns;
  const row = Math.floor(frame / sheet.columns);
  const pct = (i: number, n: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);

  return (
    <div className="sprite-stage checker">
      <div
        className="sprite-frame"
        role="img"
        aria-label={`Sprite sheet animation, frame ${frame + 1} of ${sheet.frameCount}`}
        style={{
          backgroundImage: `url(${url})`,
          backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
          backgroundPosition: `${pct(col, sheet.columns)}% ${pct(row, sheet.rows)}%`,
        }}
      />
    </div>
  );
}
