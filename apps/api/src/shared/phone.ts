import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';

// Algerian mobile numbers: national form 0[567]XXXXXXXX (10 digits), E.164 +213[567]XXXXXXXX.
const E164_DZ = /^\+213[567]\d{8}$/;

/**
 * Normalize an Algerian mobile number to E.164 (+213XXXXXXXXX), or return null if
 * it isn't a valid DZ mobile. Accepts +213.../00213.../213.../0... and ignores
 * spaces, dashes and parentheses.
 *
 * SECURITY: returns null rather than echoing the input — callers must surface a
 * STATIC error message, never the raw value (CLAUDE.md: never log phone numbers).
 */
export function normalizeDzPhone(input: string): string | null {
  const cleaned = input.replace(/[\s\-().]/g, '');

  let national: string | null = null;
  if (/^\+213\d{9}$/.test(cleaned)) {
    national = '0' + cleaned.slice(4);
  } else if (/^00213\d{9}$/.test(cleaned)) {
    national = '0' + cleaned.slice(5);
  } else if (/^213\d{9}$/.test(cleaned)) {
    national = '0' + cleaned.slice(3);
  } else if (/^0\d{9}$/.test(cleaned)) {
    national = cleaned;
  } else {
    return null;
  }

  const e164 = '+213' + national.slice(1);
  return E164_DZ.test(e164) ? e164 : null;
}

/**
 * Keyed HMAC-SHA256 of a normalized phone number, safe to use in redis keys / logs.
 * Plain SHA-256 would be brute-forceable across the ~30M DZ mobile keyspace, so the
 * server secret is required.
 */
export function hmacPhone(e164: string): string {
  return createHmac('sha256', env.PHONE_HMAC_SECRET).update(e164).digest('hex');
}
