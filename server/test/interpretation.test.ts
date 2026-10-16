import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { NodeIO } from '@gltf-transform/core';
import { ENGINES } from '@asset-gen/shared';
import { describe, expect, it } from 'vitest';
import { export3D } from '../src/exporters';
import { mockGenerator } from '../src/generators/mock';
import { analyzeImage } from '../src/generators/mock/imageAnalysis';
import { interpret } from '../src/generators/mock/interpret';
import { parsePrompt } from '../src/generators/mock/promptParser';

type Draw = (ctx: SKRSContext2D, w: number, h: number) => void;

async function picture(draw: Draw, w = 200, h = 200, background: string | null = '#ffffff') {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  draw(ctx, w, h);
  const png = await canvas.encode('png');
  return { png, image: await loadImage(png) };
}

/** Blue vase body with a brown neck: symmetric and tall, two color bands. */
const vase: Draw = (ctx) => {
  ctx.fillStyle = '#2050c0';
  ctx.beginPath();
  ctx.moveTo(70, 190);
  ctx.bezierCurveTo(10, 150, 30, 80, 85, 60);
  ctx.lineTo(115, 60);
  ctx.bezierCurveTo(170, 80, 190, 150, 130, 190);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7a4a20';
  ctx.fillRect(85, 15, 30, 46);
};

/** An asymmetric "L" bracket. */
const bracket: Draw = (ctx) => {
  ctx.fillStyle = '#30a040';
  ctx.fillRect(30, 20, 40, 160);
  ctx.fillRect(30, 140, 140, 40);
};

const crate: Draw = (ctx) => {
  ctx.fillStyle = '#a0522d';
  ctx.fillRect(40, 60, 120, 90);
};

/** A mug whose handle starts a few pixels away from the body (as in many photos). */
const mug: Draw = (ctx) => {
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#c03030';
  ctx.beginPath();
  ctx.arc(138, 100, 30, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.fillStyle = '#c84040';
  ctx.fillRect(50, 50, 84, 120);
};

const ring: Draw = (ctx) => {
  ctx.lineWidth = 30;
  ctx.strokeStyle = '#d0a020';
  ctx.beginPath();
  ctx.arc(100, 100, 60, 0, Math.PI * 2);
  ctx.stroke();
};

describe('image analysis', () => {
  it('reads a vase as a tall symmetric object with color bands', async () => {
    const { image } = await picture(vase);
    const a = analyzeImage(image);
    expect(a.hasObject).toBe(true);
    expect(a.confidence).toBeGreaterThan(0.4);
    expect(a.symmetry).toBeGreaterThan(0.85);
    expect(a.aspect).toBeGreaterThan(1);
    expect(a.bands.length).toBeGreaterThanOrEqual(2);
    // The bottom band is the blue body, the top band the brown neck.
    const bottom = a.palette[a.bands[0].index].color;
    const top = a.palette[a.bands[a.bands.length - 1].index].color;
    expect(bottom[2]).toBeGreaterThan(bottom[0]);
    expect(top[0]).toBeGreaterThan(top[2]);
    // Widest near the middle, narrow at the neck.
    const maxR = Math.max(...a.profile.map((p) => p.r));
    expect(a.profile[a.profile.length - 1].r).toBeLessThan(maxR * 0.5);
  });

  it('reads a filled rectangle as a box and an L-shape as asymmetric', async () => {
    const box = analyzeImage((await picture(crate)).image);
    expect(box.fill).toBeGreaterThan(0.9);
    expect(box.aspect).toBeCloseTo(90 / 120, 1);

    const l = analyzeImage((await picture(bracket)).image);
    expect(l.symmetry).toBeLessThan(0.7);
    expect(l.shapes[0].outer.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps a detached handle and the opening inside it', async () => {
    const a = analyzeImage((await picture(mug)).image);
    expect(a.shapes.length + a.shapes[0].holes.length).toBeGreaterThanOrEqual(2);
    expect(a.coreFraction).toBeGreaterThan(0.6);
    expect(a.appendages.length).toBe(1);
    // The handle sits on the right of the body's axis.
    expect(Math.min(...a.appendages[0].outline.outer.map((p) => p[0]))).toBeGreaterThan(0);
  });

  it('finds openings in a ring', async () => {
    const a = analyzeImage((await picture(ring)).image);
    expect(a.shapes[0].holes.length).toBe(1);
  });

  it('uses the alpha channel of transparent PNGs', async () => {
    const { image } = await picture(
      (ctx) => {
        ctx.fillStyle = '#e0c020';
        ctx.beginPath();
        ctx.arc(100, 100, 70, 0, Math.PI * 2);
        ctx.fill();
      },
      200,
      200,
      null,
    );
    const a = analyzeImage(image);
    expect(a.confidence).toBeGreaterThan(0.9);
    expect(a.circularity).toBeGreaterThan(0.8);
    expect(a.palette[0].color[0]).toBeGreaterThan(0.8);
  });

  it('gives up on the outline when nothing stands out from the background', async () => {
    const { image } = await picture((ctx, w, h) => {
      let seed = 1;
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < w; x += 4) {
          seed = (seed * 16807) % 2147483647;
          ctx.fillStyle = `hsl(${seed % 360}, 70%, 50%)`;
          ctx.fillRect(x, y, 4, 4);
        }
    });
    const a = analyzeImage(image);
    const spec = interpret(parsePrompt(''), [a], '3d');
    expect(spec.form.kind).toBe('preset');
    expect(spec.notes.join(' ')).toMatch(/Couldn't separate an object/);
  });
});

describe('interpretation: text outweighs the image', () => {
  it('infers a revolved form from a vase photo when the text names no shape', async () => {
    const a = analyzeImage((await picture(vase)).image);
    const spec = interpret(parsePrompt(''), [a], '3d');
    expect(spec.form.kind).toBe('revolve');
    expect(spec.notes[0]).toMatch(/symmetric object/);
  });

  it('infers box, inflate, extrude and composite forms', async () => {
    const kind = async (draw: Draw, prompt = '', organic = false) =>
      interpret(parsePrompt(prompt), [analyzeImage((await picture(draw)).image)], '3d', null, { organic }).form.kind;
    expect(await kind(crate)).toBe('box');
    expect(await kind(bracket)).toBe('inflate');
    expect(await kind(ring)).toBe('inflate'); // spinning a ring would fill its opening
    expect(await kind(mug)).toBe('composite');
    expect(await kind(bracket, 'flat cutout')).toBe('extrude');
    expect(await kind(vase, '', true)).toBe('inflate'); // organic subjects are never spun
  });

  it('lets a text shape, colors and modifiers override the photo', async () => {
    const a = analyzeImage((await picture(vase)).image);
    const spec = interpret(parsePrompt('tall glowing red sword with gold trim'), [a], '3d');
    expect(spec.form).toEqual({ kind: 'preset', shape: 'sword' });
    expect(spec.primary).toEqual(parsePrompt('red').color);
    expect(spec.accent).toEqual(parsePrompt('gold').color);
    expect(spec.modifiers).toMatchObject({ height: 1.45, glowing: true });
    expect(spec.notes.join(' ')).toMatch(/Your text decided the shape/);
    expect(spec.notes.join(' ')).toMatch(/From your text: color red \+ gold/);
  });

  it('treats a material-like accent color as a color, not the whole material', () => {
    const p = parsePrompt('green potion with gold cork');
    expect(p.surface).toBe('plain');
    expect(p.accent).toEqual(parsePrompt('gold').color);
    expect(parsePrompt('gold coin').surface).toBe('metal');
  });

  it('recolors the image-derived bands with the text color', async () => {
    const a = analyzeImage((await picture(vase)).image);
    const spec = interpret(parsePrompt('green'), [a], '3d');
    if (spec.form.kind !== 'revolve') throw new Error('expected revolve');
    const green = parsePrompt('green').color!;
    expect(spec.form.bands.some((b) => b.color === green)).toBe(true);
  });

  it('uses image colors and proportions for a text shape that names no color', async () => {
    const a = analyzeImage((await picture(vase)).image);
    const spec = interpret(parsePrompt('potion'), [a], '3d');
    expect(spec.primary).toEqual(a.palette[0].color);
    expect(spec.imageAspect).toBeCloseTo(a.aspect);
  });

  it('picks the clearest of several images (video frames)', async () => {
    const noisy = analyzeImage((await picture((ctx) => ctx.fillRect(0, 0, 3, 3))).image);
    const clear = analyzeImage((await picture(vase)).image);
    const spec = interpret(parsePrompt(''), [noisy, clear], '3d');
    expect(spec.form.kind).toBe('revolve');
    expect(spec.notes.join(' ')).toMatch(/used #2/);
  });
});

describe('building from inferred forms', () => {
  const validate = (mesh: Awaited<ReturnType<typeof mockGenerator.generate3D>>) => {
    let minY = Infinity;
    let maxDim = 0;
    for (const p of mesh.parts) {
      expect(p.positions.every(Number.isFinite)).toBe(true);
      expect(p.normals.every(Number.isFinite)).toBe(true);
      expect(Math.max(...p.indices)).toBeLessThan(p.positions.length / 3);
      for (let i = 0; i < p.positions.length; i += 3) {
        minY = Math.min(minY, p.positions[i + 1]);
        maxDim = Math.max(maxDim, Math.abs(p.positions[i]), p.positions[i + 1], Math.abs(p.positions[i + 2]));
      }
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxDim).toBeLessThan(1.5);
  };

  it.each([
    ['vase', vase],
    ['crate', crate],
    ['bracket', bracket],
    ['mug', mug],
    ['ring', ring],
  ] as const)('builds a valid mesh from a %s photo without using the photo as a texture', async (_label, draw) => {
    const { png } = await picture(draw);
    const mesh = await mockGenerator.generate3D({ prompt: '', images: [{ data: png, mime: 'image/png' }], engine: ENGINES.godot });
    validate(mesh);
    expect(Buffer.from(mesh.texture!.png).equals(png)).toBe(false);
    expect(mesh.texture!.width).toBe(256);
  });

  it('writes glow into the GLB when the text says "glowing"', async () => {
    const { png } = await picture(vase);
    const mesh = await mockGenerator.generate3D({ prompt: 'glowing', images: [{ data: png, mime: 'image/png' }], engine: ENGINES.godot });
    const { file } = await export3D('glb', mesh, ENGINES.godot, 'vase');
    const doc = await new NodeIO().readBinary(file.data);
    expect(doc.getRoot().listMaterials()[0].getEmissiveFactor().some((v) => v > 0)).toBe(true);
  });

  it('applies lowpoly and proportion words to preset shapes', async () => {
    const plain = await mockGenerator.generate3D({ prompt: 'orb', images: [], engine: ENGINES.godot });
    const styled = await mockGenerator.generate3D({ prompt: 'tall low poly orb', images: [], engine: ENGINES.godot });
    const height = (m: typeof plain) => Math.max(...m.parts.flatMap((p) => p.positions.filter((_, i) => i % 3 === 1)));
    expect(height(styled)).toBeCloseTo(height(plain) * 1.45, 3);
    expect(styled.parts[0].positions.length).toBeLessThan(plain.parts[0].positions.length * 1.5);
  });

  it('redraws a 2D sprite from the photo instead of copying it', async () => {
    const { png } = await picture(vase);
    const sprite = await mockGenerator.generate2D({ prompt: '', images: [{ data: png, mime: 'image/png' }], engine: ENGINES.godot, size: 128, frameCount: 1 });
    const f = sprite.frames[0];
    expect(f.data[3]).toBe(0); // background removed
    const at = (x: number, y: number) => f.data.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4);
    expect(at(64, 90)[3]).toBe(255); // body is drawn
    expect(sprite.summary).toMatch(/symmetric sprite/);
  });
});
