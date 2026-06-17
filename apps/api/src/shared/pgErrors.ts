import { AppError } from './httpError.js';

/** Minimal shape of a node-postgres error we care about. */
interface PgErrorLike {
  code?: string | undefined;
  constraint?: string | undefined;
}

export function asPgError(err: unknown): PgErrorLike | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const e = err as Record<string, unknown>;
    if (typeof e['code'] === 'string') {
      return { code: e['code'], constraint: typeof e['constraint'] === 'string' ? e['constraint'] : undefined };
    }
  }
  return null;
}

export function pgErrorCode(err: unknown): string | undefined {
  return asPgError(err)?.code;
}

/**
 * Map a known Postgres error to an AppError so the central errorHandler returns
 * the right status. Returns null for anything unrecognized (caller should rethrow,
 * which surfaces as a 500).
 *
 * NOTE: 23505 on the bookings idempotency key is handled specially in the bookings
 * service (re-SELECT + replay) BEFORE this mapper is consulted.
 */
export function mapPgError(err: unknown): AppError | null {
  const pg = asPgError(err);
  if (!pg) return null;

  switch (pg.code) {
    case '23P01': // exclusion_violation
      switch (pg.constraint) {
        case 'bookings_no_overlap':
          return new AppError(409, 'Slot no longer available');
        case 'no_overlapping_time_off':
          return new AppError(409, 'Overlapping time off for this barber');
        case 'no_overlapping_shift':
          return new AppError(409, 'Overlapping working-hours shift');
        default:
          return new AppError(409, 'Conflicting record');
      }
    case '23505': // unique_violation
      return new AppError(409, 'Already exists');
    case '23503': // foreign_key_violation (e.g. barber not in shop / service mismatch)
      return new AppError(400, 'Referenced record does not exist');
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
      return new AppError(400, 'Invalid date or time');
    default:
      return null;
  }
}
