import { pool } from '../../config/db.js';
import { env } from '../../config/env.js';
import type { AvailabilityDTO } from '@barber/shared-types';
import type { ResolvedShop } from '../../shared/reqContext.js';

/**
 * Free-slot computation. ALL local↔UTC conversion happens in Postgres via
 * `(date + minutes) AT TIME ZONE shop.tz` — never a hardcoded +1 — and each candidate
 * boundary is converted individually so it stays correct for a future DST tenant.
 *
 * - working_hours store minute-of-day in shop-LOCAL wall-clock; bookings/time-off are UTC.
 * - generate_series walks the shift grid up to (end_min - duration) so the whole service
 *   fits inside the shift.
 * - now() (one DB clock) + lead time is the past floor; overlap reads use range `&&` so a
 *   booking straddling local midnight is still detected.
 */
const SLOT_SQL = `
WITH params AS (
  SELECT $1::uuid AS shop_id, $2::uuid AS barber_id, $3::date AS d,
         $4::text AS tz, $5::int AS dur, $6::int AS gran, $7::int AS lead
)
SELECT c.slot_start AS slot_start,
       c.slot_start + make_interval(mins => c.dur) AS slot_end
FROM (
  SELECT ((p.d::timestamp + make_interval(mins => gs.m)) AT TIME ZONE p.tz) AS slot_start,
         p.dur AS dur, p.barber_id AS barber_id, p.lead AS lead
  FROM params p
  JOIN working_hours wh
    ON wh.shop_id = p.shop_id AND wh.barber_id = p.barber_id
   AND wh.weekday = EXTRACT(DOW FROM p.d)::int
  CROSS JOIN LATERAL generate_series(wh.start_min, wh.end_min - p.dur, p.gran) AS gs(m)
) c
WHERE c.slot_start >= now() + make_interval(mins => c.lead)
  AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.barber_id = c.barber_id
      AND b.status IN ('pending','confirmed')
      AND b.during && tstzrange(c.slot_start, c.slot_start + make_interval(mins => c.dur), '[)')
  )
  AND NOT EXISTS (
    SELECT 1 FROM barber_time_off t
    WHERE t.barber_id = c.barber_id
      AND t.during && tstzrange(c.slot_start, c.slot_start + make_interval(mins => c.dur), '[)')
  )
ORDER BY c.slot_start
`;

interface SlotRow {
  slot_start: Date;
  slot_end: Date;
}

export async function getAvailability(
  shop: ResolvedShop,
  barberId: string,
  serviceId: string,
  date: string,
): Promise<AvailabilityDTO> {
  // 1. Service must be active and in this shop.
  const svcRes = await pool.query<{ duration_min: number }>(
    `SELECT duration_min FROM services WHERE id = $1 AND shop_id = $2 AND is_active`,
    [serviceId, shop.id],
  );
  const duration = svcRes.rows[0]?.duration_min;

  // 2. Barber must be an active member of this shop.
  let barberActive = false;
  if (duration !== undefined) {
    const b = await pool.query(
      `SELECT 1 FROM barber_shops bs JOIN barbers b ON b.id = bs.barber_id
       WHERE bs.barber_id = $1 AND bs.shop_id = $2 AND bs.is_active AND b.is_active`,
      [barberId, shop.id],
    );
    barberActive = (b.rowCount ?? 0) > 0;
  }

  // SECURITY (anti-enumeration): a not-bookable barber/service returns the SAME
  // 200 {slots:[]} as a valid-but-fully-booked one — barber/service existence never leaks.
  if (duration === undefined || !barberActive) {
    return { barberId, date, serviceId, durationMin: duration ?? 0, slots: [] };
  }

  const { rows } = await pool.query<SlotRow>(SLOT_SQL, [
    shop.id,
    barberId,
    date,
    shop.timezone,
    duration,
    env.SLOT_GRANULARITY_MIN,
    env.BOOKING_MIN_LEAD_MIN,
  ]);

  return {
    barberId,
    date,
    serviceId,
    durationMin: duration,
    slots: rows.map((r) => ({ start: r.slot_start.toISOString(), end: r.slot_end.toISOString() })),
  };
}
