import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { ReferenceInfo } from '@asset-gen/shared';
import { ENGINES } from '@asset-gen/shared';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateMask } from '../src/generators/mock/geometry';
import { mockGenerator } from '../src/generators/mock';
import { analyzeImage } from '../src/generators/mock/imageAnalysis';
import { loadImage } from '@napi-rs/canvas';
import { OpenverseProvider, WikimediaProvider, type ReferenceCandidate } from '../src/references/providers';
import { WebReferenceFinder, type ReferenceFinder } from '../src/references';
import { makeTestApp, type TestApp } from './helpers';

type Draw = (ctx: SKRSContext2D) => void;

async function png(draw: Draw, w = 160, h = 200, bg = '#ffffff') {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  draw(ctx);
  return c.encode('png');
}

/** A standing figure: head, torso, arms and legs. */
const figure: Draw = (ctx) => {
  ctx.fillStyle = '#c0504d';
  ctx.beginPath();
  ctx.arc(80, 30, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(58, 48, 44, 70); // torso
  ctx.fillRect(40, 50, 14, 60); // arms
  ctx.fillRect(106, 50, 14, 60);
  ctx.fillStyle = '#34495e';
  ctx.fillRect(60, 118, 16, 70); // legs
  ctx.fillRect(84, 118, 16, 70);
};

/** A long rifle-like side profile. */
const longGun: Draw = (ctx) => {
  ctx.fillStyle = '#5b3a1e';
  ctx.fillRect(10, 90, 60, 26);
  ctx.fillStyle = '#333333';
  ctx.fillRect(60, 94, 110, 10);
};

const blob: Draw = (ctx) => {
  ctx.fillStyle = '#2255aa';
  ctx.beginPath();
  ctx.arc(80, 100, 60, 0, Math.PI * 2);
  ctx.fill();
};

const ref = (title: string, url: string): ReferenceInfo => ({
  title,
  author: 'Tester',
  license: 'CC BY 4.0',
  licenseUrl: null,
  pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
  imageUrl: url,
  provider: 'Wikimedia Commons',
});

/** Serves canned search results and images, recording what was asked. */
function fakeFinder(results: Record<string, { info: ReferenceInfo; image: Buffer }[]>) {
  const queries: string[] = [];
  const images = new Map(Object.values(results).flat().map((r) => [r.info.imageUrl, r.image]));
  const finder: ReferenceFinder & { queries: string[] } = {
    queries,
    async search(query) {
      queries.push(query);
      return (results[query] ?? []).map((r, rank): ReferenceCandidate => ({ info: r.info, rank }));
    },
    async fetchImage(url) {
      const img = images.get(url);
      if (!img) throw new Error('404');
      return img;
    },
  };
  return finder;
}

describe('silhouette inflation', () => {
  it('builds a closed mesh that is thick at the body and thin at the limbs', async () => {
    const a = analyzeImage(await loadImage(await png(figure)));
    const g = inflateMask(a.mask, 1);
    expect(g.positions.every(Number.isFinite)).toBe(true);

    // Watertight: every edge is shared by exactly two triangles.
    const edges = new Map<string, number>();
    for (let i = 0; i < g.indices.length; i += 3) {
      for (const [p, q] of [
        [g.indices[i], g.indices[i + 1]],
        [g.indices[i + 1], g.indices[i + 2]],
        [g.indices[i + 2], g.indices[i]],
      ]) {
        const key = p < q ? `${p},${q}` : `${q},${p}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);

    // Depth near the torso center vs near an arm (x relative to the figure center, y up 0..1).
    const depthNear = (x: number, y: number) => {
      let best = Infinity;
      let z = 0;
      for (let i = 0; i < g.positions.length; i += 3) {
        const d = Math.hypot(g.positions[i] - x, g.positions[i + 1] - y);
        if (d < best) {
          best = d;
          z = Math.abs(g.positions[i + 2]);
        }
      }
      return z;
    };
    const height = a.mask.h;
    const torso = depthNear(0, (200 - 85 - 12) / height);
    const arm = depthNear(-33 / height, (200 - 80 - 12) / height);
    expect(torso).toBeGreaterThan(arm * 1.8);
  });
});

describe('reference picking', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('models a person from the cleanest relevant, correctly shaped reference', async () => {
    const finder = fakeFinder({
      'person transparent background': [
        { info: ref('World map of peoples', 'https://upload.wikimedia.org/map.png'), image: await png(blob) }, // not an object
        { info: ref('Person sitting', 'https://upload.wikimedia.org/wide.png'), image: await png(longGun) }, // wrong shape
        { info: ref('Woman standing isolated', 'https://upload.wikimedia.org/figure.png'), image: await png(figure) },
      ],
    });
    const mesh = await mockGenerator.generate3D({ prompt: 'person', images: [], engine: ENGINES.unity, references: finder });
    expect(mesh.generation).toMatchObject({ source: 'web-reference', form: 'inflate' });
    expect(mesh.generation.reference?.title).toBe('Woman standing isolated');
    expect(mesh.summary).toMatch(/Found a reference image online/);
    // Scaled to real-world size: a person is 1.75 m tall.
    const ys = mesh.parts.flatMap((p) => p.positions.filter((_, i) => i % 3 === 1));
    expect(Math.max(...ys)).toBeCloseTo(1.75, 2);
  });

  it('falls back to the general subject when nothing specific fits', async () => {
    const finder = fakeFinder({ 'person standing transparent background': [{ info: ref('Man standing', 'https://upload.wikimedia.org/m.png'), image: await png(figure) }] });
    const mesh = await mockGenerator.generate3D({ prompt: 'knight', images: [], engine: ENGINES.unity, references: finder });
    expect(finder.queries).toEqual([
      'knight transparent background',
      'knight standing transparent background',
      'knight full length portrait white background',
      'knight isolated',
      'knight silhouette',
      'knight',
      'person standing transparent background',
    ]);
    expect(mesh.generation.reference?.title).toBe('Man standing');
  });

  it('does not search for objects the app already knows, or when the user uploads a photo', async () => {
    const finder = fakeFinder({});
    await mockGenerator.generate3D({ prompt: 'wooden chair', images: [], engine: ENGINES.unity, references: finder });
    await mockGenerator.generate3D({ prompt: 'rifle', images: [{ data: await png(longGun), mime: 'image/png' }], engine: ENGINES.unity, references: finder });
    await mockGenerator.generate3D({ prompt: 'rifle', images: [], engine: ENGINES.unity, references: finder, referenceMode: 'never' });
    expect(finder.queries).toEqual([]);
    await mockGenerator.generate3D({ prompt: 'wooden chair', images: [], engine: ENGINES.unity, references: finder, referenceMode: 'always' });
    expect(finder.queries[0]).toBe('wooden chair transparent background');
  });

  it('explains when no reference qualifies and still produces a model', async () => {
    const finder = fakeFinder({ rifle: [{ info: ref('Rifle', 'https://upload.wikimedia.org/r.png'), image: await png(blob) }] }); // round, not elongated
    const mesh = await mockGenerator.generate3D({ prompt: 'rifle', images: [], engine: ENGINES.unity, references: finder });
    expect(mesh.generation.source).not.toBe('web-reference');
    expect(mesh.summary).toMatch(/found no clean, isolated reference image/);
  });

  it('skips a disliked reference on the next attempt (feedback loop through the API)', async () => {
    const finder = fakeFinder({
      rifle: [
        // Both fit inside the frame (a 160 px canvas would crop the barrel, which the picker rightly penalizes).
        { info: ref('Rifle A', 'https://upload.wikimedia.org/a.png'), image: await png(longGun, 190, 200) },
        { info: ref('Rifle B', 'https://upload.wikimedia.org/b.png'), image: await png(longGun, 200, 200) },
      ],
    });
    const t: TestApp = makeTestApp({ references: finder });
    try {
      const gen = () => request(t.app).post('/api/generate').send({ mode: '3d', prompt: 'rifle', engine: 'unreal', format: 'glb' }).expect(201);
      const first = (await gen()).body.asset;
      expect(first.reference.title).toBe('Rifle A');
      expect(first.source).toBe('web-reference');
      await request(t.app).post(`/api/assets/${first.id}/feedback`).send({ liked: false, comment: 'wrong gun' }).expect(200);
      const second = (await gen()).body.asset;
      expect(second.reference.title).toBe('Rifle B');
      expect(second.summary).toMatch(/Skipped 1 reference image/);
    } finally {
      t.cleanup();
    }
  });

  it('parses Wikimedia and Openverse results into attributions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = String(url).includes('wikimedia')
          ? {
              query: {
                pages: [
                  {
                    title: 'File:Rifle.jpg',
                    index: 1,
                    imageinfo: [
                      {
                        thumburl: 'https://upload.wikimedia.org/thumb/r.jpg',
                        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Rifle.jpg',
                        mime: 'image/jpeg',
                        extmetadata: { Artist: { value: '<a href="x">Museum</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
                      },
                    ],
                  },
                ],
              },
            }
          : { results: [{ title: 'Old rifle', creator: 'Jo', license: 'by', license_version: '2.0', foreign_landing_url: 'https://flickr.com/p', thumbnail: 'https://api.openverse.org/v1/images/1/thumb/' }] };
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const [w] = await new WikimediaProvider().search('rifle', 5);
    expect(w.info).toMatchObject({ title: 'Rifle', author: 'Museum', license: 'CC BY-SA 4.0', provider: 'Wikimedia Commons' });
    const [o] = await new OpenverseProvider().search('rifle', 5);
    expect(o.info).toMatchObject({ title: 'Old rifle', author: 'Jo', license: 'CC BY 2.0', provider: 'Openverse' });
  });

  it('refuses to fetch images from hosts other than the providers', async () => {
    const finder = new WebReferenceFinder([], null);
    await expect(finder.fetchImage('https://evil.example.com/x.png')).rejects.toThrow(/Refusing/);
    await expect(finder.fetchImage('http://upload.wikimedia.org/x.png')).rejects.toThrow(/Refusing/);
  });
});
