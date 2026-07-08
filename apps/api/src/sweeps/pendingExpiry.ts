import { pool } from '../config/db.js';
import { env } from '../config/env.js';

// Pending bookings hold their slot forever: the bookings_no_overlap EXCLUDE guard
// counts status IN ('pending','confirmed'), so a booking the shop never confirms
// blocks that window for every other customer. This sweep cancels any booking
// still 'pending' BOOKING_PENDING_EXPIRE_HOURS after it was created, which frees
// the slot immediately (cancelled rows are outside the EXCLUDE predicate).
//
// The UPDATE is a single atomic statement and the WHERE re-checks status, so
// concurrent sweeps (multiple API instances) and racing staff confirms are safe:
// whoever commits first wins, the loser matches zero rows.

export const EXPIRE_REASON = 'Expired: not confirmed in time';

/** Cancel stale pending bookings. Returns how many were expired. */
export async function expirePendingBookings(): Promise<number> {
  const res = await pool.query(
    `UPDATE bookings
     SET status = 'cancelled', cancel_reason = $1, cancelled_at = now()
     WHERE status = 'pending' AND created_at < now() - make_interval(hours => $2)`,
    [EXPIRE_REASON, env.BOOKING_PENDING_EXPIRE_HOURS],
  );
  return res.rowCount ?? 0;
}

/**
 * Run the sweep now and then every BOOKING_EXPIRY_SWEEP_INTERVAL_MIN minutes.
 * Called once at server boot; no-op when BOOKING_PENDING_EXPIRE_HOURS is 0.
 * Returns the timer (unref'd so it never keeps the process alive) or null.
 */
export function startPendingExpirySweep(): NodeJS.Timeout | null {
  if (env.BOOKING_PENDING_EXPIRE_HOURS === 0) return null;

  const tick = (): void => {
    expirePendingBookings()
      .then((n) => {
        if (n > 0) console.log(`pending-expiry sweep: cancelled ${n} stale booking(s)`);
      })
      .catch((err: unknown) => {
        console.error(
          'pending-expiry sweep failed:',
          err instanceof Error ? err.message : err,
        );
      });
  };

  tick();
  const timer = setInterval(tick, env.BOOKING_EXPIRY_SWEEP_INTERVAL_MIN * 60_000);
  timer.unref();
  return timer;
}
