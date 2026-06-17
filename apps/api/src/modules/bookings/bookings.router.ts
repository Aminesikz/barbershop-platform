import { Router } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { createPublicLimiter } from '../../shared/middleware/publicLimiter.js';
import { requireStaff } from '../../shared/middleware/requireStaff.js';
import * as ctrl from './bookings.controller.js';

// Mounted as: app.use('/api/bookings', tenantResolver, bookingsRouter)
const bookingLimiter = createPublicLimiter({ windowMs: 60_000, limit: 5, prefix: 'rl:book-ip:' });

const router = Router();

// Public self-service create (extra per-phone cap + honeypot inside the controller).
router.post('/', bookingLimiter, asyncHandler(ctrl.create));

// Staff (owner session OR barber JWT; barber sees/acts on own only).
router.get('/', requireStaff, asyncHandler(ctrl.list));
router.patch('/:id/confirm', requireStaff, asyncHandler(ctrl.confirm));
router.patch('/:id/complete', requireStaff, asyncHandler(ctrl.complete));
router.patch('/:id/cancel', requireStaff, asyncHandler(ctrl.cancel));
router.patch('/:id/no-show', requireStaff, asyncHandler(ctrl.noShow));

export { router as bookingsRouter };
