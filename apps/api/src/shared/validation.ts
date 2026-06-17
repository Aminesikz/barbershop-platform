import { z } from 'zod';
import { normalizeDzPhone } from './phone.js';

/** UUID v-any string. */
export const uuid = z.string().uuid();

/** Weekday 0=Sunday .. 6=Saturday (matches Postgres EXTRACT(DOW)). */
export const weekday = z.number().int().min(0).max(6);

/** Minute-of-day for a shift start (0..1439) and end (1..1440), shop-local wall-clock. */
export const startMinute = z.number().int().min(0).max(1439);
export const endMinute = z.number().int().min(1).max(1440);

/** Customer display name. */
export const customerName = z.string().trim().min(2).max(80);

/**
 * Real calendar date "YYYY-MM-DD" — rejects shapes that pass the regex but aren't
 * real dates (2026-02-30, 2026-13-01) so they never reach Postgres as a 22008 -> 500.
 */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Not a real calendar date');

/** ISO-8601 UTC instant (e.g. 2026-06-20T09:30:00.000Z). */
export const isoDatetime = z.string().datetime();

/**
 * Algerian mobile number, normalized to E.164 (+213XXXXXXXXX).
 * SECURITY: on failure the issue carries a STATIC message — the raw input is never
 * interpolated, so it can't leak through errorHandler's field errors.
 */
export const algerianPhone = z.string().transform((val, ctx) => {
  const normalized = normalizeDzPhone(val);
  if (!normalized) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid phone' });
    return z.NEVER;
  }
  return normalized;
});
