import { createCanvas } from '@napi-rs/canvas';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { feedbackContext, promptTokens, recordFeedback, similarity } from '../src/feedback';
import type { Blueprint } from '../src/generators/llm/blueprint';
import { makeTestApp, signedInAgent, type TestApp } from './helpers';
import { fakeTextModel, KEY } from './fixtures';

const gen = (bp: Blueprint | null) => ({ source: bp ? ('text-model' as const) : ('keywords' as const), model: bp ? 'fake-1' : null, form: 'x', blueprint: bp, reference: null });

describe('prompt similarity', () => {
  it('normalizes words and ignores filler', () => {
    expect(promptTokens('Make me some Rusty old Keys!')).toEqual(['rusty', 'old', 'key']);
    expect(similarity(promptTokens('old key'), promptTokens('rusty old keys'))).toBeCloseTo(2 / 3);
    expect(similarity(promptTokens('sword'), promptTokens('key'))).toBe(0);
  });
});

describe('feedback context', () => {
  let t: TestApp;
  afterEach(() => t.cleanup());

  const userRow = (id: string) => t.ctx.db.prepare("INSERT INTO users VALUES (?, ?, 'x', 'u', '2026-01-01')").run(id, `${id}@x.co`);

  it("weights the user's own ratings above everyone else's and finds reusable designs", () => {
    t = makeTestApp();
    userRow('me');
    userRow('other');
    const other: Blueprint = { ...KEY, name: 'other key' };
    recordFeedback(t.ctx.db, { assetId: 'a1', userId: 'other', prompt: 'old key', mode: '3d', liked: true, comment: null, generation: gen(other) });
    recordFeedback(t.ctx.db, { assetId: 'a2', userId: 'me', prompt: 'brass key', mode: '3d', liked: true, comment: null, generation: gen(KEY) });
    recordFeedback(t.ctx.db, { assetId: 'a3', userId: 'other', prompt: 'banana', mode: '3d', liked: true, comment: null, generation: gen(null) });

    const mine = feedbackContext(t.ctx.db, { prompt: 'shiny key', mode: '3d', userId: 'me' });
    expect(mine.examples.map((e) => e.prompt)).toEqual(['brass key', 'old key']); // own first, unrelated excluded
    expect(mine.examples[0].own).toBe(true);

    const guest = feedbackContext(t.ctx.db, { prompt: 'brass key', mode: '3d', userId: null });
    expect(guest.reusable?.blueprint.name).toBe('old brass key');
  });

  it('counts repeat dislikes and never reuses a design that was later disliked', () => {
    t = makeTestApp();
    userRow('me');
    recordFeedback(t.ctx.db, { assetId: 'a1', userId: null, prompt: 'key', mode: '3d', liked: true, comment: null, generation: gen(KEY) });
    recordFeedback(t.ctx.db, { assetId: 'a2', userId: 'me', prompt: 'key', mode: '3d', liked: false, comment: 'too plain', generation: gen(KEY) });
    recordFeedback(t.ctx.db, { assetId: 'a3', userId: 'me', prompt: 'keys', mode: '3d', liked: false, comment: null, generation: gen(null) });

    const ctx = feedbackContext(t.ctx.db, { prompt: 'key', mode: '3d', userId: 'me' });
    expect(ctx.repeatDislikes).toBe(2);
    expect(ctx.reusable).toBeNull();
    expect(ctx.examples.find((e) => !e.liked && e.comment)?.comment).toBe('too plain');
  });

  it('replaces an earlier vote on the same asset', () => {
    t = makeTestApp();
    recordFeedback(t.ctx.db, { assetId: 'a1', userId: null, prompt: 'key', mode: '3d', liked: true, comment: null, generation: null });
    recordFeedback(t.ctx.db, { assetId: 'a1', userId: null, prompt: 'key', mode: '3d', liked: false, comment: 'meh', generation: null });
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM feedback').get()).toEqual({ n: 1 });
  });
});

describe('feedback API and learning loop', () => {
  let t: TestApp;
  afterEach(() => t.cleanup());

  it('records a rating, shows it back, and feeds it into the next generation', async () => {
    const tm = fakeTextModel(KEY);
    t = makeTestApp({ textModel: tm });
    const alice = await signedInAgent(t.app, 'alice@example.com');

    const first = (await alice.post('/api/generate').send({ mode: '3d', prompt: 'key', engine: 'godot', format: 'glb' }).expect(201)).body.asset;
    expect(first).toMatchObject({ source: 'text-model', model: 'fake-1', feedback: null });

    const voted = await alice.post(`/api/assets/${first.id}/feedback`).send({ liked: false, comment: 'teeth too small' }).expect(200);
    expect(voted.body.asset.feedback).toBe('dislike');
    expect((await alice.get(`/api/assets/${first.id}`)).body.asset.feedback).toBe('dislike');

    // "Try again": the model now sees the dislike and the reason.
    await alice.post('/api/generate').send({ mode: '3d', prompt: 'key', engine: 'godot', format: 'glb' }).expect(201);
    const second = tm.calls[1];
    expect(second.examples).toHaveLength(1);
    expect(second.examples[0]).toMatchObject({ liked: false, comment: 'teeth too small', own: true });
    expect(second.examples[0].blueprint?.name).toBe('old brass key');
  });

  it('reuses a liked design when the text model is offline', async () => {
    t = makeTestApp({ textModel: fakeTextModel(KEY) });
    const liked = (await request(t.app).post('/api/generate').send({ mode: '3d', prompt: 'brass key', engine: 'godot', format: 'glb' })).body.asset;
    await request(t.app).post(`/api/assets/${liked.id}/feedback`).send({ liked: true }).expect(200);
    t.ctx.textModel = fakeTextModel(KEY, false);

    const reused = (await request(t.app).post('/api/generate').send({ mode: '3d', prompt: 'brass key', engine: 'godot', format: 'glb' }).expect(201))
      .body.asset;
    expect(reused.source).toBe('feedback-reuse');
    expect(reused.summary).toMatch(/design that was liked for "brass key" was reused/);
  });

  it('varies the keyword result after repeated dislikes', async () => {
    t = makeTestApp();
    const agent = await signedInAgent(t.app, 'bob@example.com');
    const gen = () => agent.post('/api/generate').send({ mode: '3d', prompt: 'dragon', engine: 'godot', format: 'glb' }).expect(201);
    const a = (await gen()).body.asset;
    await agent.post(`/api/assets/${a.id}/feedback`).send({ liked: false }).expect(200);
    const b = (await gen()).body.asset;
    expect(b.summary).toMatch(/disliked 1 earlier result/);
    expect(b.summary.split('\n')[0]).not.toBe(a.summary.split('\n')[0]);
  });

  it('uses the image for shape when the model says the text is only a style', async () => {
    t = makeTestApp({ textModel: fakeTextModel({ ...KEY, textNamesObject: false }) });
    const canvas = createCanvas(200, 200);
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 200, 200);
    c.fillStyle = '#2050c0';
    c.beginPath();
    c.arc(100, 100, 70, 0, Math.PI * 2);
    c.fill();
    const up = await request(t.app).post('/api/uploads').attach('files', await canvas.encode('png'), { filename: 'o.png', contentType: 'image/png' });
    const res = await request(t.app)
      .post('/api/generate')
      .send({ mode: '3d', prompt: 'rusty metal', engine: 'godot', format: 'glb', uploadIds: [up.body.uploads[0].id] })
      .expect(201);
    expect(res.body.asset.source).toBe('image');
    expect(res.body.asset.summary).toMatch(/read your text as a style/);
  });

  it('validates feedback input and reports text model status', async () => {
    t = makeTestApp({ textModel: fakeTextModel(KEY, false) });
    const a = (await request(t.app).post('/api/generate').send({ mode: '2d', prompt: 'coin', engine: 'godot', format: 'png' })).body.asset;
    await request(t.app).post(`/api/assets/${a.id}/feedback`).send({ liked: 'yes' }).expect(400);
    await request(t.app).post('/api/assets/missing/feedback').send({ liked: true }).expect(404);
    const status = await request(t.app).get('/api/status').expect(200);
    expect(status.body.textModel).toEqual({ provider: 'fake', model: 'fake-1', available: false, reason: 'Fake model is off.' });
  });
});
