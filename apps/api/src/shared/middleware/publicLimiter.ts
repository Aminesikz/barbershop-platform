import { rateLimit } from 'express-rate-limit';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request } from 'express';
import { redis } from '../../config/redis.js';

interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Redis key prefix — must be distinct per limiter so buckets don't collide. */
  prefix: string;
}

/**
 * Build a redis-backed rate limiter for public, tenant-scoped endpoints.
 *
 * SECURITY: the key is `${shopId}:${ip}` so a flood against one shop can't exhaust
 * another shop's budget. Relies on app.set('trust proxy', N) being correct, otherwise
 * req.ip is the proxy address and every client collapses into one bucket.
 */
export function createPublicLimiter({ windowMs, limit, prefix }: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request): string => {
      const shopId = req.shop?.id ?? 'no-shop';
      return `${shopId}:${req.ip ?? 'no-ip'}`;
    },
    store: new RedisStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendCommand: ((...args: string[]) => redis.call(...(args as [string, ...string[]]))) as any,
      prefix,
    }),
  });
}
