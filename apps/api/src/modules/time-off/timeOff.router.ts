import { Router } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { requireStaff } from '../../shared/middleware/requireStaff.js';
import * as ctrl from './timeOff.controller.js';

// Mounted as: app.use('/api/time-off', tenantResolver, timeOffRouter)
// Staff-only — time-off reveals barber absence patterns.
const router = Router();

router.get('/barbers/:barberId', requireStaff, asyncHandler(ctrl.list));
router.post('/barbers/:barberId', requireStaff, asyncHandler(ctrl.create));
router.delete('/:id', requireStaff, asyncHandler(ctrl.remove));

export { router as timeOffRouter };
