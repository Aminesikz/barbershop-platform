import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import { rateLimit } from 'express-rate-limit';
import { RedisStore as RLRedisStore } from 'rate-limit-redis';
import { env } from './config/env.js';
import { redis } from './config/redis.js';
import { authRouter } from './modules/auth/auth.router.js';
import { errorHandler } from './shared/middleware/errorHandler.js';

const app = express();

// SECURITY: helmet with explicit CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // SECURITY: restrict connect-src to known WS origin; tighten ALLOWED_ORIGIN_PATTERN in prod
        connectSrc: ["'self'", env.ALLOWED_ORIGIN_PATTERN],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
  }),
);

// SECURITY: CORS restricted to wildcard subdomain pattern via regex
const escapedPattern = env.ALLOWED_ORIGIN_PATTERN
  .replace(/\./g, '\\.')
  .replace(/\*/g, '[a-z0-9-]+');
const originPattern = new RegExp(`^${escapedPattern}$`);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || originPattern.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS: origin not allowed'));
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '64kb' }));

// Global rate limiter — more relaxed than the per-endpoint login limiter
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RLRedisStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCommand: ((...args: string[]) => redis.call(...(args as [string, ...string[]]))) as any,
    prefix: 'rl:global:',
  }),
});
app.use(globalLimiter);

// Session middleware — connect-redis v7 requires the official 'redis' package
const redisClientForSession = createClient({ url: env.REDIS_URL });
redisClientForSession.connect().catch(console.error);

app.use(
  session({
    name: 'sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new RedisStore({ client: redisClientForSession, prefix: 'sess:' }),
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: env.SESSION_MAX_AGE_MS,
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    },
  }),
);

// Routes
app.use('/auth', authRouter);

// Central error handler must be last
app.use(errorHandler);

export { app };
