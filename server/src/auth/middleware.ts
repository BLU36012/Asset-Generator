import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { User } from '@asset-gen/shared';
import type { AppContext } from '../context';
import { HttpError } from '../http';

export const AUTH_COOKIE = 'ag_token';
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

export function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export function setAuthCookie(ctx: AppContext, res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId }, ctx.jwtSecret, { expiresIn: TOKEN_TTL_SECONDS });
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.secureCookies,
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearAuthCookie(ctx: AppContext, res: Response): void {
  res.clearCookie(AUTH_COOKIE, { httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies, path: '/' });
}

/** Attaches req.user when a valid session cookie is present; never rejects. */
export function optionalAuth(ctx: AppContext) {
  const findUser = ctx.db.prepare('SELECT id, email, display_name FROM users WHERE id = ?');
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[AUTH_COOKIE];
    if (typeof token === 'string') {
      try {
        const payload = jwt.verify(token, ctx.jwtSecret);
        const sub = typeof payload === 'object' ? payload.sub : undefined;
        const row = sub ? (findUser.get(sub) as UserRow | undefined) : undefined;
        if (row) req.user = toUser(row);
      } catch {
        // Expired or tampered token: treat as a guest.
      }
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  next();
}
