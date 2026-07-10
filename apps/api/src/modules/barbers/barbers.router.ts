import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { createPublicLimiter } from '../../shared/middleware/publicLimiter.js';
import { requireOwner } from '../../shared/middleware/requireStaff.js';
import { getShop } from '../../shared/reqContext.js';
import { listActiveBarbers } from './barbers.service.js';
import * as ctrl from './barbers.controller.js';

// Mounted as: app.use('/api/barbers', tenantResolver, barbersRouter)
const publicRead = createPublicLimiter({ windowMs: 60_000, limit: 60, prefix: 'rl:pub-read:' });

const router = Router();

// Public read of ACTIVE barbers (booking UI). Names only, no PII.
router.get(
  '/',
  publicRead,
  asyncHandler(async (req: Request, res: Response) => {
    const shop = getShop(req);
    res.json({ barbers: await listActiveBarbers(shop.id) });
  }),
);

// Owner-only management (incl. inactive, with email).
router.get('/all', requireOwner, asyncHandler(ctrl.listAll));
router.post('/', requireOwner, asyncHandler(ctrl.create));
router.patch('/:id', requireOwner, asyncHandler(ctrl.update));

export { router as barbersRouter };
