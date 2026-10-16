import { lazy, Suspense, type RefObject } from 'react';
import type { Asset } from '@asset-gen/shared';
import { ErrorBoundary } from './ErrorBoundary';
import { Preview2D } from './Preview2D';
import type { CaptureFn } from './Preview3D';

// three.js is large; only load it once a 3D asset is shown.
const Preview3D = lazy(() => import('./Preview3D').then((m) => ({ default: m.Preview3D })));

const fallback = (
  <div className="preview-empty">
    <p>Preview unavailable.</p>
    <p className="small">Unsaved assets expire after 24 hours. Generate it again to get a fresh copy.</p>
  </div>
);

const loading = (
  <div className="preview-empty">
    <div className="spinner" aria-label="Loading viewer" />
  </div>
);

export function AssetPreview({ asset, captureRef }: { asset: Asset; captureRef?: RefObject<CaptureFn | null> }) {
  return (
    <ErrorBoundary key={asset.id} fallback={fallback}>
      {asset.mode === '3d' ? (
        <Suspense fallback={loading}>
          <Preview3D url={asset.previewUrl} captureRef={captureRef} />
        </Suspense>
      ) : (
        <Preview2D url={asset.previewUrl} sheet={asset.spriteSheet} />
      )}
    </ErrorBoundary>
  );
}
