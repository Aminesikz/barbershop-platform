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
import { tenantResolver } from './shared/middleware/tenantResolver.js';
import { getShop } from './shared/reqContext.js';
import { barbersRouter } from './modules/barbers/barbers.router.js';
import { servicesRouter } from './modules/services/services.router.js';
import { workingHoursRouter } from './modules/working-hours/workingHours.router.js';
import { timeOffRouter } from './modules/time-off/timeOff.router.js';
import { availabilityRouter } from './modules/availability/availability.router.js';
import { bookingsRouter } from './modules/bookings/bookings.router.js';
import { adminAuthRouter, adminRouter } from './modules/admin/admin.router.js';
import { errorHandler } from './shared/middleware/errorHandler.js';

const app = express();

// SECURITY: exact proxy-hop count so req.ip is the real client IP behind the CDN/LB.
// NEVER `true` (clients could spoof X-Forwarded-For); without it per-IP rate limits
// collapse every client into the proxy's single bucket.
app.set('trust proxy', env.TRUST_PROXY_HOPS);

// SECURITY: helmet with explicit CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // The API serves JSON only — the frontends are served separately (Vercel), so
        // this CSP governs API responses, not the booking page. The page's own
        // connect-src (to api.* + wss://api.*) is set by the frontend host. Keeping
        // 'self' here avoids emitting an invalid wildcard directive.
        connectSrc: ["'self'"],
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

// Liveness probe for the platform's health check / uptime monitors. Mounted EARLY —
// before the rate limiter and session — so probes are cheap, unthrottled, and never
// touch Redis. Liveness only (no DB ping); readiness is implied by the server booting
// (testConnection runs in server.ts before listen).
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// SECURITY: CORS restricted to wildcard subdomain pattern via regex.
// `*.<domain>` matches the subdomains AND the bare apex — the password-reset page
// is served from the apex, so its POSTs to the API must pass CORS. The subdomain
// group stays anchored (`([a-z0-9-]+\.)?`) so lookalike domains can't match.
const escapedPattern = env.ALLOWED_ORIGIN_PATTERN
  .replace(/\./g, '\\.')
  .replace(/\*\\\./g, '([a-z0-9-]+\\.)?')
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

// Platform admin — separate auth boundary, NOT tenant-scoped (no tenantResolver).
app.use('/auth/admin', adminAuthRouter);
app.use('/admin', adminRouter);

// Booking domain — every /api route is tenant-scoped via tenantResolver (sets req.shop).
// Resolve the current shop (slug → id/timezone) for clients that only know the slug.
app.get('/api/shop', tenantResolver, (req, res) => {
  res.json({ shop: getShop(req) });
});
app.use('/api/barbers', tenantResolver, barbersRouter);
app.use('/api/services', tenantResolver, servicesRouter);
app.use('/api/working-hours', tenantResolver, workingHoursRouter);
app.use('/api/time-off', tenantResolver, timeOffRouter);
app.use('/api/availability', tenantResolver, availabilityRouter);
app.use('/api/bookings', tenantResolver, bookingsRouter);

// Central error handler must be last
app.use(errorHandler);

export { app };
