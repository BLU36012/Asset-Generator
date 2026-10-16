import { NodeIO } from '@gltf-transform/core';
import { ENGINES } from '@asset-gen/shared';
import { describe, expect, it } from 'vitest';
import { export2D, export3D } from '../src/exporters';
import { buildFbx } from '../src/exporters/fbx';
import { buildObj } from '../src/exporters/obj';
import { mockGenerator } from '../src/generators/mock';
import { samplePng } from './helpers';

const PROMPTS = [
  'red wooden crate',
  'iron barrel',
  'glowing blue orb',
  'pine tree',
  'mossy rock',
  'marble pillar',
  'gold coin',
  'emerald gem',
  'mushroom',
  'small house',
  'steel sword',
  'purple potion',
  'star',
  'heart',
  'a dragon', // no keyword: falls back to a seeded shape
];

const isZip = (data: Uint8Array) => data[0] === 0x50 && data[1] === 0x4b; // "PK"

describe('mock 3D generator + exporters', () => {
  it.each(PROMPTS)('"%s" builds valid geometry', async (prompt) => {
    const mesh = await mockGenerator.generate3D({ prompt, images: [], engine: ENGINES.godot });
    expect(mesh.parts.length).toBeGreaterThan(0);
    let minY = Infinity;
    for (const part of mesh.parts) {
      const vertexCount = part.positions.length / 3;
      expect(part.normals.length).toBe(part.positions.length);
      expect(part.uvs.length).toBe(vertexCount * 2);
      expect(part.indices.length % 3).toBe(0);
      expect(Math.max(...part.indices)).toBeLessThan(vertexCount);
      expect(part.positions.every(Number.isFinite)).toBe(true);
      for (let i = 1; i < part.positions.length; i += 3) minY = Math.min(minY, part.positions[i]);
    }
    expect(minY).toBeCloseTo(0, 5); // pivot sits on the ground
  });

  it('GLB round-trips through glTF-Transform', async () => {
    const mesh = await mockGenerator.generate3D({ prompt: 'wooden barrel', images: [], engine: ENGINES.godot });
    const { file, preview } = await export3D('glb', mesh, ENGINES.godot, 'barrel');
    expect(file.fileName).toBe('barrel.glb');
    const doc = await new NodeIO().readBinary(file.data);
    const prims = doc.getRoot().listMeshes()[0].listPrimitives();
    expect(prims.length).toBe(mesh.parts.length);
    expect(prims[0].getAttribute('POSITION')!.getCount()).toBe(mesh.parts[0].positions.length / 3);
    expect(doc.getRoot().listTextures().length).toBe(1);
    expect(preview.mime).toBe('model/gltf-binary');
  });

  it('OBJ has matching v/vt/vn/f counts, materials and engine scaling', async () => {
    const mesh = await mockGenerator.generate3D({ prompt: 'crate', images: [], engine: ENGINES.unreal });
    const { obj, mtl } = buildObj(mesh, 'crate', ENGINES.unreal.objScale);
    const count = (prefix: string) => obj.split('\n').filter((l) => l.startsWith(prefix + ' ')).length;
    const verts = mesh.parts.reduce((n, p) => n + p.positions.length / 3, 0);
    const tris = mesh.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    expect(count('v')).toBe(verts);
    expect(count('vt')).toBe(verts);
    expect(count('vn')).toBe(verts);
    expect(count('f')).toBe(tris);
    expect(mtl).toContain('map_Kd crate_texture.png');
    // A 1 m crate becomes 100 units tall for Unreal (centimeters).
    const ys = obj.split('\n').filter((l) => l.startsWith('v ')).map((l) => Number(l.split(' ')[2]));
    expect(Math.max(...ys)).toBeCloseTo(100, 3);
  });

  it('FBX declares consistent array lengths and connections', async () => {
    const mesh = await mockGenerator.generate3D({ prompt: 'small house', images: [], engine: ENGINES.unity });
    const fbx = buildFbx(mesh, 'house');
    const verts = mesh.parts.reduce((n, p) => n + p.positions.length / 3, 0);
    const tris = mesh.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    expect(fbx.startsWith('; FBX 7.4.0 project file')).toBe(true);
    expect(fbx).toContain(`Vertices: *${verts * 3} {`);
    expect(fbx).toContain(`PolygonVertexIndex: *${tris * 3} {`);
    expect(fbx).toContain(`Materials: *${tris} {`);
    expect((fbx.match(/^\tMaterial: /gm) ?? []).length).toBe(mesh.materials.length);
    expect(fbx).toContain('C: "OP",4000,3000, "DiffuseColor"');
    // Braces balance, so the file is structurally well-formed.
    expect((fbx.match(/{/g) ?? []).length).toBe((fbx.match(/}/g) ?? []).length);
  });

  it.each(['gltf', 'obj', 'fbx'] as const)('%s export is zipped with its texture', async (format) => {
    const mesh = await mockGenerator.generate3D({ prompt: 'stone pillar', images: [], engine: ENGINES.roblox });
    const { file } = await export3D(format, mesh, ENGINES.roblox, 'pillar');
    expect(isZip(file.data)).toBe(true);
    expect(file.fileName.endsWith('.zip')).toBe(true);
  });

  it('models an uploaded photo instead of pasting it as a texture', async () => {
    const png = await samplePng(200, 100);
    const mesh = await mockGenerator.generate3D({ prompt: '', images: [{ data: png, mime: 'image/png' }], engine: ENGINES.godot });
    expect(mesh.texture).toMatchObject({ width: 256, height: 256 });
    expect(mesh.summary).toMatch(/Read your image/);
  });
});

describe('mock 2D generator + exporters', () => {
  it('writes PNG, JPG and TGA with correct headers', async () => {
    const sprite = await mockGenerator.generate2D({ prompt: 'gold coin', images: [], engine: ENGINES.godot, size: 128, frameCount: 1 });
    const png = (await export2D('png', sprite, 'coin')).file.data;
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const jpg = (await export2D('jpg', sprite, 'coin')).file.data;
    expect([...jpg.subarray(0, 2)]).toEqual([0xff, 0xd8]);

    const tga = Buffer.from((await export2D('tga', sprite, 'coin')).file.data);
    expect(tga[2]).toBe(2);
    expect(tga.readUInt16LE(12)).toBe(128);
    expect(tga.readUInt16LE(14)).toBe(128);
    expect(tga.length).toBe(18 + 128 * 128 * 4);
  });

  it('builds a sprite sheet with frame metadata', async () => {
    const sprite = await mockGenerator.generate2D({ prompt: 'pixel heart', images: [], engine: ENGINES.roblox, size: 64, frameCount: 8 });
    const { file, spriteSheet } = await export2D('spritesheet', sprite, 'heart');
    expect(isZip(file.data)).toBe(true);
    expect(spriteSheet).toEqual({ frameCount: 8, fps: 8, columns: 4, rows: 2, frameWidth: 64, frameHeight: 64 });
  });

  it('turns an uploaded image into a sprite', async () => {
    const png = await samplePng();
    const sprite = await mockGenerator.generate2D({ prompt: '', images: [{ data: png, mime: 'image/png' }], engine: ENGINES.unity, size: 128, frameCount: 1 });
    const center = sprite.frames[0].data.subarray((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 4);
    expect(center[3]).toBe(255); // image is drawn in the middle
    expect(sprite.frames[0].data[3]).toBe(0); // corners stay transparent
  });
});
