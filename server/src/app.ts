import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { optionalAuth } from './auth/middleware';
import { authRouter } from './auth/routes';
import type { AppContext } from './context';
import { HttpError } from './http';
import { assetsRouter } from './routes/assets';
import { designsRouter } from './routes/designs';
import { generateRouter } from './routes/generate';
import { statusRouter } from './routes/status';
import { uploadsRouter } from './routes/uploads';

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' })); // room for a base64 thumbnail
  app.use(cookieParser());
  app.use(optionalAuth(ctx));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/status', statusRouter(ctx));
  app.use('/api/auth', authRouter(ctx));
  app.use('/api/uploads', uploadsRouter(ctx));
  app.use('/api/generate', generateRouter(ctx));
  app.use('/api/designs', designsRouter(ctx));
  app.use('/api/assets', assetsRouter(ctx));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // In production, serve the built client from the same origin.
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 10 MB or smaller.' : err.message;
      return res.status(400).json({ error: message });
    }
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Malformed JSON body.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
