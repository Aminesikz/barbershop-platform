import { Router } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { createPublicLimiter } from '../../shared/middleware/publicLimiter.js';
import { requireOwner } from '../../shared/middleware/requireStaff.js';
import * as ctrl from './reviews.controller.js';

// Mounted in app.ts as: app.use('/api/reviews', tenantResolver, reviewsRouter)
const publicRead = createPublicLimiter({ windowMs: 60_000, limit: 60, prefix: 'rl:rev-read:' });
const submitLimiter = createPublicLimiter({ windowMs: 60_000, limit: 5, prefix: 'rl:rev-submit:' });

const router = Router();

// Public: approved reviews + aggregates (shop page), token context, submission.
// Submission needs no honeypot — a valid one-time token IS the spam gate.
router.get('/', publicRead, asyncHandler(ctrl.listPublic));
router.get('/context', publicRead, asyncHandler(ctrl.context));
router.post('/', submitLimiter, asyncHandler(ctrl.submit));

// Owner-only moderation.
router.get('/all', requireOwner, asyncHandler(ctrl.listAll));
router.patch('/:id', requireOwner, asyncHandler(ctrl.moderate));

export { router as reviewsRouter };
