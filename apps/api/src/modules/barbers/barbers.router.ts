import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { createPublicLimiter } from '../../shared/middleware/publicLimiter.js';
import { getShop } from '../../shared/reqContext.js';
import { listActiveBarbers } from './barbers.service.js';

// Mounted as: app.use('/api/barbers', tenantResolver, barbersRouter)
const publicRead = createPublicLimiter({ windowMs: 60_000, limit: 60, prefix: 'rl:pub-read:' });

const router = Router();

router.get(
  '/',
  publicRead,
  asyncHandler(async (req: Request, res: Response) => {
    const shop = getShop(req);
    res.json({ barbers: await listActiveBarbers(shop.id) });
  }),
);

export { router as barbersRouter };
