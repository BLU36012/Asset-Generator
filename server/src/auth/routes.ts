import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { AppContext } from '../context';
import { nowIso } from '../db';
import { badRequest, HttpError } from '../http';
import { clearAuthCookie, setAuthCookie, toUser } from './middleware';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const findByEmail = ctx.db.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = ctx.db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
  );

  router.post('/register', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const displayName = String(req.body?.displayName ?? '').trim() || email.split('@')[0];

    if (!EMAIL_RE.test(email)) throw badRequest('Enter a valid email address.');
    if (password.length < MIN_PASSWORD) throw badRequest(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (displayName.length > 60) throw badRequest('Display name must be 60 characters or fewer.');
    if (findByEmail.get(email)) throw new HttpError(409, 'An account with that email already exists.');

    const id = randomUUID();
    const hash = await bcrypt.hash(password, 10);
    insertUser.run(id, email, hash, displayName, nowIso());

    setAuthCookie(ctx, res, id);
    res.status(201).json({ user: { id, email, displayName } });
  });

  router.post('/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const row = findByEmail.get(email) as UserRow | undefined;

    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      throw new HttpError(401, 'Incorrect email or password.');
    }

    setAuthCookie(ctx, res, row.id);
    res.json({ user: toUser(row) });
  });

  router.post('/logout', (_req, res) => {
    clearAuthCookie(ctx, res);
    res.json({ ok: true });
  });

  // Guests get { user: null } rather than a 401 so the client can probe quietly.
  router.get('/me', (req, res) => {
    res.json({ user: req.user ?? null });
  });

  return router;
}
