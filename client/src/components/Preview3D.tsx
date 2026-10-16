import { Bounds, Environment, Grid, Lightformer, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, type RefObject } from 'react';

/** Returns a small PNG data URL of the current view, used as the library thumbnail. */
export type CaptureFn = () => string;

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

function downscale(source: HTMLCanvasElement, maxWidth = 360): string {
  const scale = Math.min(1, maxWidth / source.width);
  const out = document.createElement('canvas');
  out.width = Math.round(source.width * scale);
  out.height = Math.round(source.height * scale);
  out.getContext('2d')!.drawImage(source, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

export function Preview3D({ url, captureRef }: { url: string; captureRef?: RefObject<CaptureFn | null> }) {
  return (
    <Canvas
      camera={{ position: [2.2, 1.8, 2.6], fov: 45 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => {
        if (captureRef) captureRef.current = () => downscale(gl.domElement);
      }}
    >
      <color attach="background" args={['#070b16']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={1.8} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#00d4ff" />
      {/* A small studio built from light panels, so metal and glass have something to reflect (no HDR download). */}
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={2.5} position={[0, 4, 2]} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-4, 1, -2]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1} color="#7cc4ff" position={[4, 1, 1]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
      </Environment>
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.4}>
          <Model url={url} />
        </Bounds>
      </Suspense>
      <Grid
        infiniteGrid
        cellSize={0.25}
        sectionSize={1}
        cellColor="#173a6b"
        sectionColor="#1f8fff"
        fadeDistance={18}
        position={[0, -0.001, 0]}
      />
      <OrbitControls makeDefault />
    </Canvas>
  );
}
