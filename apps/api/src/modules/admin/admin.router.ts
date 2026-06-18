import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../../config/redis.js';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { requirePlatformAdmin } from './admin.middleware.js';
import { adminLogin, adminLogout, adminMe } from './admin.auth.controller.js';
import * as shops from './admin.controller.js';

// SECURITY: stricter limiter for admin login — the real brute-force defense.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCommand: ((...args: string[]) => redis.call(...(args as [string, ...string[]]))) as any,
    prefix: 'rl:admin-login:',
  }),
});

// Mounted at /auth/admin (NOT tenant-scoped).
const authRouter = Router();
authRouter.post('/login', adminLoginLimiter, asyncHandler(adminLogin));
authRouter.post('/logout', requirePlatformAdmin, adminLogout);
authRouter.get('/me', requirePlatformAdmin, adminMe);

// Mounted at /admin (NOT tenant-scoped). Everything behind requirePlatformAdmin.
const apiRouter = Router();
apiRouter.use(requirePlatformAdmin);
apiRouter.get('/shops', asyncHandler(shops.listShops));
apiRouter.post('/shops', asyncHandler(shops.createShop));
apiRouter.patch('/shops/:id', asyncHandler(shops.updateShop));

export { authRouter as adminAuthRouter, apiRouter as adminRouter };
