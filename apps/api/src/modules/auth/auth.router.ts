import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../../config/redis.js';
import { requireOwnerSession, requireBarberJWT } from './auth.middleware.js';
import { ownerLogin, ownerLogout, ownerMe, barberLogin, barberMe } from './auth.controller.js';

// SECURITY: stricter rate limit for login endpoints to mitigate brute-force attacks
const ownerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCommand: ((...args: string[]) => redis.call(...(args as [string, ...string[]]))) as any,
    prefix: 'rl:owner-login:',
  }),
});

const router = Router();

router.post('/owner/login', ownerLoginLimiter, ownerLogin);
router.post('/owner/logout', requireOwnerSession, ownerLogout);
router.get('/owner/me', requireOwnerSession, ownerMe);

router.post('/barber/login', barberLogin);
router.get('/barber/me', requireBarberJWT, barberMe);

export { router as authRouter };
