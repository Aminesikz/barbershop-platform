import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Session
  SESSION_SECRET: z.string().min(32),
  SESSION_MAX_AGE_MS: z.coerce.number().int().positive().default(86_400_000), // 24h

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // CORS
  ALLOWED_ORIGIN_PATTERN: z.string(),

  // Cookie domain
  COOKIE_DOMAIN: z.string().optional(),

  // PII protection: keyed HMAC for phone-derived redis/dedup keys (never plain SHA-256).
  PHONE_HMAC_SECRET: z.string().min(32),

  // SECURITY: exact number of proxy hops in front of the API (CDN + LB). NEVER 'true'
  // (that lets clients spoof X-Forwarded-For and collapses per-IP rate limits).
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(1),

  // Booking policy
  BOOKING_HORIZON_DAYS: z.coerce.number().int().positive().default(60),
  BOOKING_MIN_LEAD_MIN: z.coerce.number().int().nonnegative().default(0),
  SLOT_GRANULARITY_MIN: z.coerce.number().int().positive().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
