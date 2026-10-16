import { Router } from 'express';
import type { StatusResponse } from '@asset-gen/shared';
import type { AppContext } from '../context';

/** Lets the UI show the state of the server's AI model and reference search. */
export function statusRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const tm = ctx.textModel;
    const body: StatusResponse = {
      textModel: tm ? { provider: tm.provider, model: tm.model, ...(await tm.status()) } : null,
      references: { enabled: ctx.references !== null },
    };
    res.json(body);
  });
  return router;
}
