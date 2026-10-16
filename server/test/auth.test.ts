import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers';

describe('auth', () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it('registers, reports the session, logs out and logs back in', async () => {
    const agent = request.agent(t.app);
    const reg = await agent
      .post('/api/auth/register')
      .send({ email: 'Ada@Example.com', password: 'password123', displayName: 'Ada' })
      .expect(201);
    expect(reg.body.user).toMatchObject({ email: 'ada@example.com', displayName: 'Ada' });
    expect(reg.headers['set-cookie'][0]).toMatch(/HttpOnly/i);

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user.email).toBe('ada@example.com');

    await agent.post('/api/auth/logout').expect(200);
    expect((await agent.get('/api/auth/me').expect(200)).body.user).toBeNull();

    const login = await agent.post('/api/auth/login').send({ email: 'ada@example.com', password: 'password123' }).expect(200);
    expect(login.body.user.displayName).toBe('Ada');
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('ada@example.com');
  });

  it('rejects a duplicate email with 409', async () => {
    await request(t.app).post('/api/auth/register').send({ email: 'a@b.co', password: 'password123' }).expect(201);
    const res = await request(t.app).post('/api/auth/register').send({ email: 'A@B.co', password: 'password123' }).expect(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it('rejects a wrong password with 401', async () => {
    await request(t.app).post('/api/auth/register').send({ email: 'a@b.co', password: 'password123' }).expect(201);
    await request(t.app).post('/api/auth/login').send({ email: 'a@b.co', password: 'nope-nope' }).expect(401);
    await request(t.app).post('/api/auth/login').send({ email: 'missing@b.co', password: 'password123' }).expect(401);
  });

  it('validates email and password length', async () => {
    await request(t.app).post('/api/auth/register').send({ email: 'not-an-email', password: 'password123' }).expect(400);
    await request(t.app).post('/api/auth/register').send({ email: 'a@b.co', password: 'short' }).expect(400);
  });

  it('ignores a tampered session cookie', async () => {
    const res = await request(t.app).get('/api/auth/me').set('Cookie', 'ag_token=garbage').expect(200);
    expect(res.body.user).toBeNull();
  });
});
