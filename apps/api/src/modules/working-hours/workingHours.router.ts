import { Router } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { createPublicLimiter } from '../../shared/middleware/publicLimiter.js';
import { requireStaff } from '../../shared/middleware/requireStaff.js';
import * as ctrl from './workingHours.controller.js';

// Mounted as: app.use('/api/working-hours', tenantResolver, workingHoursRouter)
const publicRead = createPublicLimiter({ windowMs: 60_000, limit: 60, prefix: 'rl:pub-read:' });

const router = Router();

router.get('/barbers/:barberId', publicRead, asyncHandler(ctrl.listPublic));
router.put('/barbers/:barberId', requireStaff, asyncHandler(ctrl.replace));

export { router as workingHoursRouter };
