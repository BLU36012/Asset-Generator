import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NodeIO } from '@gltf-transform/core';
import { ENGINES } from '@asset-gen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { export3D } from '../src/exporters';
import { PART_SHAPES, sanitizeBlueprint, type Blueprint } from '../src/generators/llm/blueprint';
import { LAYOUT_SCHEMA, layoutToBlueprint, sanitizeLayout } from '../src/generators/llm/layout';
import { LIBRARY } from '../src/generators/llm/library';
import { OllamaTextModel } from '../src/generators/llm/ollama';
import { buildDesignMessages } from '../src/generators/llm/prompt';
import { mockGenerator } from '../src/generators/mock';
import { fakeTextModel, KEY } from './fixtures';

describe('blueprint sanitizing', () => {
  it('fills defaults, clamps numbers and rejects empty results', () => {
    const bp = sanitizeBlueprint({
      name: 'thing',
      text_names_object: false,
      parts: [{ name: 'p', shape: 'hexagon', size: [1e9, -5, 'x'], position: [0, 0, 0], rotation: [0, 0, 0], color: 'red', material: 'unobtainium' }],
    });
    expect(bp.textNamesObject).toBe(false);
    expect(bp.parts[0]).toMatchObject({ shape: 'box', size: [50, 0.002, 0.1], color: '#9a9aa2', material: 'plastic' });
    expect(() => sanitizeBlueprint({ parts: [] })).toThrow(/no parts/);
    expect(sanitizeBlueprint({ parts: [{ color: '#abc' }] }).parts[0].color).toBe('#aabbcc');
  });
});

describe('building from blueprints', () => {
  it.each(PART_SHAPES)('builds a valid %s part', async (shape) => {
    const bp: Blueprint = {
      name: shape,
      summary: '',
      textNamesObject: true,
      parts: [{ name: shape, shape, size: [0.4, 0.3, 0.2], position: [0, 0.2, 0], rotation: [10, 20, 30], color: '#3366cc', material: 'plastic' }],
    };
    const mesh = await mockGenerator.generate3D({ prompt: shape, images: [], engine: ENGINES.godot, textModel: fakeTextModel(bp) });
    const p = mesh.parts[0];
    expect(p.positions.every(Number.isFinite)).toBe(true);
    expect(p.normals.every(Number.isFinite)).toBe(true);
    expect(Math.max(...p.indices)).toBeLessThan(p.positions.length / 3);
    // Outward-facing: the summed face normals of a closed solid point away from its center.
    let outward = 0;
    for (let i = 0; i < p.indices.length; i += 3) {
      const [a, b, c] = [p.indices[i] * 3, p.indices[i + 1] * 3, p.indices[i + 2] * 3];
      const e1 = [0, 1, 2].map((k) => p.positions[b + k] - p.positions[a + k]);
      const e2 = [0, 1, 2].map((k) => p.positions[c + k] - p.positions[a + k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const centroid = [0, 1, 2].map((k) => (p.positions[a + k] + p.positions[b + k] + p.positions[c + k]) / 3);
      outward += n[0] * centroid[0] + n[1] * (centroid[1] - 0.2) + n[2] * centroid[2];
    }
    expect(outward).toBeGreaterThan(0);
  });

  it('turns a "key" prompt into a multi-part key instead of a random preset', async () => {
    const tm = fakeTextModel(KEY);
    const mesh = await mockGenerator.generate3D({ prompt: 'key', images: [], engine: ENGINES.unity, textModel: tm });
    expect(tm.calls[0]).toMatchObject({ prompt: 'key', mode: '3d', imageSummary: null });
    expect(mesh.generation).toMatchObject({ source: 'text-model', model: 'fake-1', form: 'blueprint' });
    expect(mesh.summary).toMatch(/Designed from your text by the fake-1 text model/);
    expect(mesh.materials.length).toBe(2); // brass + darker teeth, grouped by color/material
    // Real-world size: about 7.5 cm tall, sitting on the ground.
    const ys = mesh.parts.flatMap((p) => p.positions.filter((_, i) => i % 3 === 1));
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeGreaterThan(0.06);
    expect(Math.max(...ys)).toBeLessThan(0.1);
    const doc = await new NodeIO().readBinary((await export3D('glb', mesh, ENGINES.unity, 'key')).file.data);
    expect(doc.getRoot().listMaterials()[0].getMetallicFactor()).toBeCloseTo(0.9);
  });

  it('renders a blueprint as a shaded, outlined 2D sprite', async () => {
    const sprite = await mockGenerator.generate2D({
      prompt: 'key',
      images: [],
      engine: ENGINES.godot,
      size: 128,
      frameCount: 1,
      textModel: fakeTextModel(KEY),
    });
    const d = sprite.frames[0].data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] === 255) opaque++;
    expect(opaque).toBeGreaterThan(300);
    expect(d[3]).toBe(0); // corner stays transparent
  });

  it('falls back to keywords with an explanation when the model is offline or fails', async () => {
    const offline = await mockGenerator.generate3D({ prompt: 'gold coin', images: [], engine: ENGINES.godot, textModel: fakeTextModel(KEY, false) });
    expect(offline.generation.source).toBe('keywords');
    expect(offline.summary).toMatch(/Text model unavailable: Fake model is off/);

    const broken = fakeTextModel(() => {
      throw new Error('boom');
    });
    const failed = await mockGenerator.generate3D({ prompt: 'gold coin', images: [], engine: ENGINES.godot, textModel: broken });
    expect(failed.summary).toMatch(/The text model failed \(boom\)/);
  });

  it('applies style words on top of a blueprint', async () => {
    const mesh = await mockGenerator.generate3D({ prompt: 'glowing shiny key', images: [], engine: ENGINES.godot, textModel: fakeTextModel(KEY) });
    expect(mesh.materials.every((m) => m.emissive && m.roughness <= 0.15)).toBe(true);
    expect(mesh.summary).toMatch(/Style words applied: shiny, glowing/);
  });
});

describe('relative layout engine', () => {
  type Box = { min: number[]; max: number[] };
  const boxOf = (p: Blueprint['parts'][number]): Box => {
    // Axis-aligned approximation is enough here: library rotations are multiples of 90°.
    const r = p.rotation.map((d) => Math.round(d / 90) % 2 !== 0);
    let [w, h, d] = p.size;
    if (r[0]) [h, d] = [d, h];
    if (r[2]) [w, h] = [h, w];
    const half = [w / 2, h / 2, d / 2];
    return { min: p.position.map((v, k) => v - half[k]), max: p.position.map((v, k) => v + half[k]) };
  };
  const touches = (a: Box, b: Box) => [0, 1, 2].every((k) => a.min[k] <= b.max[k] + 1e-6 && b.min[k] <= a.max[k] + 1e-6);

  it.each(LIBRARY.map((e) => [e.design.name, e.design] as const))('lays out "%s" as one connected object', (_name, design) => {
    const bp = layoutToBlueprint(sanitizeLayout(JSON.parse(JSON.stringify(design))));
    const boxes = bp.parts.map(boxOf);
    // Flood through touching parts starting from the first one.
    const seen = new Set([0]);
    for (let grew = true; grew; ) {
      grew = false;
      boxes.forEach((b, i) => {
        if (!seen.has(i) && [...seen].some((j) => touches(boxes[j], b))) {
          seen.add(i);
          grew = true;
        }
      });
    }
    expect(seen.size).toBe(boxes.length);
  });

  it('puts chair legs under the seat corners and the backrest on its back edge', () => {
    const chair = layoutToBlueprint(LIBRARY.find((e) => e.keywords.includes('chair'))!.design);
    const seat = chair.parts.find((p) => p.name === 'seat')!;
    const legs = chair.parts.filter((p) => p.name.startsWith('leg'));
    const back = chair.parts.find((p) => p.name === 'backrest')!;
    expect(legs).toHaveLength(4);
    expect(legs.every((l) => l.position[1] < seat.position[1])).toBe(true);
    expect(new Set(legs.map((l) => `${Math.sign(l.position[0])},${Math.sign(l.position[2])}`)).size).toBe(4);
    expect(back.position[1]).toBeGreaterThan(seat.position[1]);
    expect(back.position[2]).toBeLessThan(seat.position[2] - 0.15);
  });

  it('drops repeated copies of a multi-copy part and tolerates bad references', () => {
    const leg = { name: 'leg', shape: 'box', size: [0.04, 0.45, 0.04], attach_to: 'seat', side: 'below', align: 'center', arrangement: 'corners', rotation: [0, 0, 0], color: '#000000', material: 'wood' };
    const design = sanitizeLayout({
      name: 'chair',
      parts: [
        { ...leg, name: 'seat', size: [0.45, 0.05, 0.45], attach_to: 'ground', side: 'ground', arrangement: 'single' },
        leg,
        { ...leg, name: 'leg', align: 'left' },
        { ...leg, name: 'back', size: [0.45, 0.45, 0.04], attach_to: 'nonexistent', side: 'on_top', arrangement: 'single' },
      ],
    });
    expect(design.parts.map((p) => p.name)).toEqual(['seat', 'leg', 'back']);
    const bp = layoutToBlueprint(design);
    expect(bp.parts).toHaveLength(6); // seat + 4 legs + back (attached to the previous part)
  });
});

describe('design prompt', () => {
  it('includes liked examples and dislike reasons', () => {
    const messages = buildDesignMessages({
      prompt: 'rusty key',
      mode: '3d',
      imageSummary: 'a tall object',
      examples: [
        { prompt: 'old key', liked: true, blueprint: KEY, comment: null, own: true },
        { prompt: 'key', liked: false, blueprint: KEY, comment: 'teeth too small', own: false },
      ],
    });
    const last = messages[messages.length - 1].content;
    expect(last).toMatch(/Design: rusty key/);
    expect(last).toMatch(/Reference image: a tall object/);
    expect(last).toMatch(/"old key" \(this user\)/);
    expect(last).toMatch(/Their reason: "teeth too small"/);
    expect(messages.some((m) => m.role === 'assistant' && m.content.includes('old brass key'))).toBe(true);
  });
});

describe('Ollama client', () => {
  let server: Server;
  let url: string;
  let lastChat: Record<string, unknown> | null = null;
  let reply: string = JSON.stringify(LIBRARY.find((e) => e.keywords.includes('key'))!.design);

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
        if (req.url === '/api/chat') {
          lastChat = JSON.parse(body);
          return res.end(JSON.stringify({ message: { role: 'assistant', content: reply }, done: true }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('reports availability based on downloaded models', async () => {
    expect(await new OllamaTextModel({ url, model: 'qwen2.5:3b' }).status()).toEqual({ available: true });
    const missing = await new OllamaTextModel({ url, model: 'llama3.2' }).status();
    expect(missing.available).toBe(false);
    expect(missing.reason).toMatch(/ollama pull llama3.2/);
    const down = await new OllamaTextModel({ url: 'http://127.0.0.1:9', model: 'x' }).status();
    expect(down.reason).toMatch(/isn't reachable/);
  });

  it('sends the schema-constrained chat and parses the blueprint', async () => {
    const tm = new OllamaTextModel({ url, model: 'qwen2.5:3b' });
    const bp = await tm.design({ prompt: 'key', mode: '3d', imageSummary: null, examples: [] });
    expect(bp.parts).toHaveLength(4);
    expect(bp.layout?.parts_plan).toMatch(/shaft/);
    expect(lastChat).toMatchObject({ model: 'qwen2.5:3b', stream: false, format: LAYOUT_SCHEMA });
    const messages = lastChat!.messages as { content: string }[];
    expect(messages.at(-1)!.content).toMatch(/Design: key/);
    // The library's key design is offered as the nearest worked example (placed last, just before the request).
    expect(messages.at(-2)!.content).toContain('"name":"old key"');
  });

  it('rejects malformed output', async () => {
    reply = 'not json';
    await expect(new OllamaTextModel({ url, model: 'qwen2.5:3b' }).design({ prompt: 'k', mode: '3d', imageSummary: null, examples: [] })).rejects.toThrow(
      /valid JSON/,
    );
  });
});
