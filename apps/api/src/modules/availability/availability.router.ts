import { Router } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { createPublicLimiter } from '../../shared/middleware/publicLimiter.js';
import { read } from './availability.controller.js';

// Mounted as: app.use('/api/availability', tenantResolver, availabilityRouter)
// Tighter limit than other public reads — blunts day-by-day slot scraping.
const availabilityLimiter = createPublicLimiter({ windowMs: 60_000, limit: 30, prefix: 'rl:pub-avail:' });

const router = Router();
router.get('/', availabilityLimiter, asyncHandler(read));

export { router as availabilityRouter };
