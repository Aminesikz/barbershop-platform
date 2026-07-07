import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../../config/redis.js';
import { requireOwnerSession, requireBarberJWT } from './auth.middleware.js';
import { ownerLogin, ownerLogout, ownerMe, barberLogin, barberMe } from './auth.controller.js';
import {
  ownerForgotPassword,
  ownerResetPassword,
  barberForgotPassword,
  barberResetPassword,
} from './passwordReset.controller.js';
import { asyncHandler } from '../../shared/asyncHandler.js';

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

// SECURITY: forgot-password triggers outbound email — keep the per-IP budget small
// so the endpoint can't be used to spam a victim's inbox or burn the email quota.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCommand: ((...args: string[]) => redis.call(...(args as [string, ...string[]]))) as any,
    prefix: 'rl:pw-forgot:',
  }),
});

// Reset consumes a token; limit brute-force guessing of token values.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCommand: ((...args: string[]) => redis.call(...(args as [string, ...string[]]))) as any,
    prefix: 'rl:pw-reset:',
  }),
});

const router = Router();

router.post('/owner/login', ownerLoginLimiter, ownerLogin);
router.post('/owner/logout', requireOwnerSession, ownerLogout);
router.get('/owner/me', requireOwnerSession, ownerMe);
router.post('/owner/forgot-password', forgotPasswordLimiter, asyncHandler(ownerForgotPassword));
router.post('/owner/reset-password', resetPasswordLimiter, asyncHandler(ownerResetPassword));

router.post('/barber/login', barberLogin);
router.get('/barber/me', requireBarberJWT, barberMe);
router.post('/barber/forgot-password', forgotPasswordLimiter, asyncHandler(barberForgotPassword));
router.post('/barber/reset-password', resetPasswordLimiter, asyncHandler(barberResetPassword));

export { router as authRouter };
