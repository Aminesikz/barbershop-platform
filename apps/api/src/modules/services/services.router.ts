import { Router } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { createPublicLimiter } from '../../shared/middleware/publicLimiter.js';
import { requireOwner } from '../../shared/middleware/requireStaff.js';
import * as ctrl from './services.controller.js';

// Mounted in app.ts as: app.use('/api/services', tenantResolver, servicesRouter)
const publicRead = createPublicLimiter({ windowMs: 60_000, limit: 60, prefix: 'rl:pub-read:' });

const router = Router();

// Public read of ACTIVE services (booking UI). Separate from the owner endpoint —
// never branch auth inside a public handler.
router.get('/', publicRead, asyncHandler(ctrl.listPublic));

// Owner-only management.
router.get('/all', requireOwner, asyncHandler(ctrl.listAll));
router.post('/', requireOwner, asyncHandler(ctrl.create));
router.patch('/:id', requireOwner, asyncHandler(ctrl.update));
router.delete('/:id', requireOwner, asyncHandler(ctrl.remove));

export { router as servicesRouter };
