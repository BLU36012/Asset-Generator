import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, samplePng, signedInAgent, type TestApp } from './helpers';

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('generate / assets / designs API', () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it('lets a guest generate and download, but not save', async () => {
    const gen = await request(t.app)
      .post('/api/generate')
      .send({ mode: '3d', prompt: 'red wooden crate', engine: 'godot', format: 'glb' })
      .expect(201);
    const asset = gen.body.asset;
    expect(asset).toMatchObject({ mode: '3d', format: 'glb', engine: 'godot', saved: false, fileName: 'red-wooden-crate.glb' });

    const dl = await request(t.app).get(asset.downloadUrl).buffer(true).parse(binary).expect(200);
    expect(dl.body.subarray(0, 4).toString()).toBe('glTF');
    await request(t.app).get(asset.previewUrl).expect(200);

    await request(t.app).post(`/api/assets/${asset.id}/save`).send({}).expect(401);
  });

  it('names the exported file after the requested name', async () => {
    const res = await request(t.app)
      .post('/api/generate')
      .send({ mode: '3d', prompt: 'barrel', engine: 'roblox', format: 'obj', name: 'Loot Barrel #2' })
      .expect(201);
    expect(res.body.asset).toMatchObject({ name: 'Loot Barrel #2', fileName: 'loot_barrel_2_obj.zip' });
  });

  it('validates the request', async () => {
    const send = (body: object) => request(t.app).post('/api/generate').send(body);
    await send({ mode: '3d', prompt: '', engine: 'godot', format: 'glb' }).expect(400); // no input
    await send({ mode: '2d', prompt: 'x', engine: 'godot', format: 'glb' }).expect(400); // wrong mode
    await send({ mode: '3d', prompt: 'x', engine: 'cryengine', format: 'glb' }).expect(400);
    await send({ mode: '3d', prompt: 'x', engine: 'godot', format: 'glb', uploadIds: ['missing'] }).expect(400);
  });

  it('saves an asset into the library and keeps it private to its owner', async () => {
    const alice = await signedInAgent(t.app, 'alice@example.com');
    const bob = await signedInAgent(t.app, 'bob@example.com');

    const { asset } = (
      await alice.post('/api/generate').send({ mode: '3d', prompt: 'steel sword', engine: 'unreal', format: 'fbx' }).expect(201)
    ).body;
    const thumbnail = 'data:image/png;base64,' + (await samplePng(8, 8)).toString('base64');
    const saved = (await alice.post(`/api/assets/${asset.id}/save`).send({ name: 'Hero sword', thumbnail }).expect(200)).body.asset;
    expect(saved).toMatchObject({ saved: true, name: 'Hero sword', thumbnailUrl: `/api/assets/${asset.id}/thumbnail` });

    expect((await alice.get('/api/assets').expect(200)).body.assets.map((a: { id: string }) => a.id)).toEqual([asset.id]);
    expect((await bob.get('/api/assets').expect(200)).body.assets).toEqual([]);

    await bob.get(`/api/assets/${asset.id}`).expect(404);
    await bob.get(saved.downloadUrl).expect(404);
    await request(t.app).get(saved.downloadUrl).expect(404);
    await bob.post(`/api/assets/${asset.id}/save`).send({}).expect(404);
    await bob.delete(`/api/assets/${asset.id}`).expect(404);

    await alice.get(saved.downloadUrl).expect(200);
    await alice.delete(`/api/assets/${asset.id}`).expect(200);
    expect((await alice.get('/api/assets')).body.assets).toEqual([]);
  });

  it('uploads an image, generates a sprite sheet from it, and saves a design', async () => {
    const alice = await signedInAgent(t.app, 'alice@example.com');
    const bob = await signedInAgent(t.app, 'bob@example.com');

    const up = await alice.post('/api/uploads').attach('files', await samplePng(), { filename: 'photo.png', contentType: 'image/png' }).expect(201);
    const uploadId = up.body.uploads[0].id;
    await alice.get(up.body.uploads[0].url).expect(200).expect('Content-Type', /image\/png/);

    const gen = await alice
      .post('/api/generate')
      .send({ mode: '2d', prompt: 'sticker', engine: 'roblox', format: 'spritesheet', uploadIds: [uploadId] })
      .expect(201);
    expect(gen.body.asset.spriteSheet).toMatchObject({ frameCount: 8, columns: 4, frameWidth: 256 });

    const settings = { mode: '2d', engine: 'roblox', format: 'spritesheet' };
    const created = (await alice.post('/api/designs').send({ name: 'Sticker', prompt: 'sticker', settings, uploadIds: [uploadId] }).expect(201))
      .body.design;
    expect(created).toMatchObject({ name: 'Sticker', settings, uploadIds: [uploadId] });

    const updated = (await alice.put(`/api/designs/${created.id}`).send({ name: 'Sticker v2', prompt: 'pixel sticker', settings, uploadIds: [uploadId] }).expect(200))
      .body.design;
    expect(updated.name).toBe('Sticker v2');

    // The upload is now claimed by Alice, so Bob can't attach it to his own design.
    await bob.post('/api/designs').send({ prompt: 'x', settings, uploadIds: [uploadId] }).expect(400);
    await bob.get(`/api/designs/${created.id}`).expect(404);
    expect((await bob.get('/api/designs')).body.designs).toEqual([]);

    await alice.post(`/api/assets/${gen.body.asset.id}/save`).send({ designId: created.id }).expect(200);
    await bob.post('/api/designs').send({ prompt: 'x', settings: { mode: '3d', engine: 'roblox', format: 'png' } }).expect(400);

    await alice.delete(`/api/designs/${created.id}`).expect(200);
    expect((await alice.get('/api/designs')).body.designs).toEqual([]);
  });

  it('rejects non-image uploads', async () => {
    const res = await request(t.app)
      .post('/api/uploads')
      .attach('files', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);
    expect(res.body.error).toMatch(/PNG, JPG and WebP/);
  });

  it('requires sign-in for the library', async () => {
    await request(t.app).get('/api/assets').expect(401);
    await request(t.app).get('/api/designs').expect(401);
  });
});
