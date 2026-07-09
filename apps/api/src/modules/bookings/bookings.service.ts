import { pool, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { eventBus } from '../../shared/eventBus.js';
import { mapPgError, pgErrorCode } from '../../shared/pgErrors.js';
import { badRequest, conflict, notFound } from '../../shared/httpError.js';
import type { ResolvedShop } from '../../shared/reqContext.js';
import type { StaffPrincipal } from '../../shared/principal.js';
import type { BookingDTO, PublicBookingDTO, BookingStatus } from '@barber/shared-types';
import {
  type BookingRow,
  type BookingFullRow,
  toBookingDTO,
  toPublicDTO,
  toBroadcastDTO,
} from './bookings.mapper.js';

// Raw bookings-table columns (no join). lower/upper(during) expose the stored range.
const RAW_COLS = `
  id, shop_id, barber_id, service_id, customer_name, customer_phone, customer_email,
  lower(during) AS start_at, upper(during) AS end_at, status, source,
  cancel_reason, confirmed_at, completed_at, cancelled_at, created_at`;

// Booking + barber/service names, for public/broadcast shapes (no phone).
const FULL_SELECT = `
  SELECT b.id, b.barber_id, b.service_id, b.customer_name,
         lower(b.during) AS start_at, upper(b.during) AS end_at, b.status,
         ba.name_ar AS barber_name_ar, ba.name_en AS barber_name_en,
         se.name_ar AS service_name_ar, se.name_en AS service_name_en
  FROM bookings b
  JOIN barbers ba ON ba.id = b.barber_id
  JOIN services se ON se.id = b.service_id`;

// Authoritative-adjacent slot validation (overlap is enforced by the EXCLUDE constraint).
// in_hours: the whole [start, start+dur) fits a working window for that shop-local weekday.
const VALIDATE_SQL = `
WITH s AS (
  SELECT $1::timestamptz AS start_at, $2::int AS dur, $3::text AS tz,
         $4::uuid AS barber_id, $5::uuid AS shop_id, $6::int AS lead, $7::int AS horizon
)
SELECT
  (s.start_at >= now() + make_interval(mins => s.lead))  AS not_past,
  (s.start_at <= now() + make_interval(days => s.horizon)) AS within_horizon,
  EXISTS (
    SELECT 1 FROM working_hours wh
    WHERE wh.barber_id = s.barber_id AND wh.shop_id = s.shop_id
      AND wh.weekday = EXTRACT(DOW FROM (s.start_at AT TIME ZONE s.tz))::int
      AND wh.start_min <= floor(EXTRACT(EPOCH FROM ((s.start_at AT TIME ZONE s.tz)::time)) / 60)
      AND wh.end_min   >= floor(EXTRACT(EPOCH FROM ((s.start_at AT TIME ZONE s.tz)::time)) / 60) + s.dur
  ) AS in_hours,
  NOT EXISTS (
    SELECT 1 FROM barber_time_off t
    WHERE t.barber_id = s.barber_id
      AND t.during && tstzrange(s.start_at, s.start_at + make_interval(mins => s.dur), '[)')
  ) AS no_time_off
FROM s`;

export interface CreateBookingInput {
  barberId: string;
  serviceId: string;
  start: string; // ISO-8601 UTC
  customerName: string;
  customerPhone: string; // normalized E.164
  customerPhoneHmac: string;
  customerEmail: string | null;
  idempotencyKey: string;
}

async function fetchFullByIdempotency(shopId: string, key: string): Promise<BookingFullRow | null> {
  const { rows } = await pool.query<BookingFullRow>(
    `${FULL_SELECT} WHERE b.shop_id = $1 AND b.idempotency_key = $2`,
    [shopId, key],
  );
  return rows[0] ?? null;
}

/**
 * Create a public booking. One transaction:
 *  lock barber (FOR UPDATE) → load active service → validate slot (past/horizon/hours/time-off)
 *  → INSERT (overlap guarded by the EXCLUDE constraint) → COMMIT → emit REDACTED broadcast.
 * 23P01 → 409 slot taken; 23505 → idempotent replay (no second emit).
 */
export async function createBooking(
  shop: ResolvedShop,
  input: CreateBookingInput,
): Promise<PublicBookingDTO> {
  let fullRow: BookingFullRow;
  try {
    fullRow = await withTransaction(async (client) => {
      // CONCURRENCY: per-barber lock; also asserts active shop membership.
      const lock = await client.query(
        `SELECT 1 FROM barber_shops WHERE barber_id = $1 AND shop_id = $2 AND is_active FOR UPDATE`,
        [input.barberId, shop.id],
      );
      if (lock.rowCount === 0) throw notFound('Barber not available');

      const svcRes = await client.query<{ duration_min: number; price_dzd: number }>(
        `SELECT duration_min, price_dzd FROM services WHERE id = $1 AND shop_id = $2 AND is_active`,
        [input.serviceId, shop.id],
      );
      const service = svcRes.rows[0];
      if (!service) throw notFound('Service not available');

      const v = await client.query<{
        not_past: boolean;
        within_horizon: boolean;
        in_hours: boolean;
        no_time_off: boolean;
      }>(VALIDATE_SQL, [
        input.start,
        service.duration_min,
        shop.timezone,
        input.barberId,
        shop.id,
        env.BOOKING_MIN_LEAD_MIN,
        env.BOOKING_HORIZON_DAYS,
      ]);
      const chk = v.rows[0];
      if (!chk) throw new Error('validation query returned no row');
      if (!chk.not_past) throw badRequest('Start time is in the past');
      if (!chk.within_horizon) throw badRequest('Start time is beyond the booking horizon');
      // Generic "not available" so out-of-hours vs time-off isn't an info leak.
      if (!chk.in_hours || !chk.no_time_off) throw conflict('Requested slot is not available');

      const ins = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (shop_id, barber_id, service_id, customer_name, customer_phone, customer_phone_hmac,
            customer_email, start_at, duration_min, price_dzd, status, source, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10,'pending','public',$11)
         RETURNING id`,
        [
          shop.id,
          input.barberId,
          input.serviceId,
          input.customerName,
          input.customerPhone,
          input.customerPhoneHmac,
          input.customerEmail,
          input.start,
          service.duration_min,
          service.price_dzd,
          input.idempotencyKey,
        ],
      );
      const id = ins.rows[0]?.id;
      if (!id) throw new Error('INSERT did not return an id');

      const full = await client.query<BookingFullRow>(`${FULL_SELECT} WHERE b.id = $1`, [id]);
      const row = full.rows[0];
      if (!row) throw new Error('Full select returned no row');
      return row;
    });
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      // Duplicate idempotency key → replay the original (NO second broadcast).
      const existing = await fetchFullByIdempotency(shop.id, input.idempotencyKey);
      if (existing) return toPublicDTO(existing);
    }
    throw mapPgError(err) ?? err; // 23P01 → 409 slot taken
  }

  // COMMIT succeeded → broadcast the REDACTED payload (already wired in ws.server).
  eventBus.emit('booking.created', {
    shopId: shop.id,
    barberId: input.barberId,
    booking: toBroadcastDTO(fullRow),
  });
  return toPublicDTO(fullRow);
}

export interface ListBookingsQuery {
  from?: string | undefined;
  to?: string | undefined;
  barberId?: string | undefined;
  status?: BookingStatus | undefined;
  limit?: number | undefined;
}

export async function listBookings(
  shopId: string,
  staff: StaffPrincipal,
  q: ListBookingsQuery,
): Promise<BookingDTO[]> {
  const params: unknown[] = [shopId];
  let where = 'shop_id = $1';
  let i = 2;

  // SECURITY: a barber may only ever see their own bookings.
  if (staff.kind === 'barber') {
    where += ` AND barber_id = $${i}`;
    params.push(staff.id);
    i += 1;
  } else if (q.barberId) {
    where += ` AND barber_id = $${i}`;
    params.push(q.barberId);
    i += 1;
  }
  if (q.status) {
    where += ` AND status = $${i}`;
    params.push(q.status);
    i += 1;
  }
  if (q.from) {
    where += ` AND start_at >= $${i}::timestamptz`;
    params.push(q.from);
    i += 1;
  }
  if (q.to) {
    where += ` AND start_at < $${i}::timestamptz`;
    params.push(q.to);
    i += 1;
  }

  params.push(q.limit ?? 50);
  const { rows } = await pool.query<BookingRow>(
    `SELECT ${RAW_COLS} FROM bookings WHERE ${where} ORDER BY start_at DESC LIMIT $${i}`,
    params,
  );
  return rows.map(toBookingDTO);
}

export type BookingAction = 'confirm' | 'complete' | 'cancel' | 'no_show';

interface TransitionDef {
  from: BookingStatus[];
  to: BookingStatus;
  tsCol: string | null;
}

const TRANSITIONS: Record<BookingAction, TransitionDef> = {
  confirm: { from: ['pending'], to: 'confirmed', tsCol: 'confirmed_at' },
  complete: { from: ['confirmed'], to: 'completed', tsCol: 'completed_at' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled', tsCol: 'cancelled_at' },
  no_show: { from: ['confirmed'], to: 'no_show', tsCol: null },
};

export async function transitionBooking(
  shopId: string,
  staff: StaffPrincipal,
  id: string,
  action: BookingAction,
  reason?: string | null,
): Promise<BookingDTO> {
  const def = TRANSITIONS[action];
  const sets = ['status = $1'];
  const params: unknown[] = [def.to];
  let i = 2;
  if (def.tsCol) sets.push(`${def.tsCol} = now()`);
  if (action === 'cancel') {
    sets.push(`cancel_reason = $${i}`);
    params.push(reason ?? null);
    i += 1;
  }

  params.push(id);
  const idIdx = i;
  i += 1;
  params.push(shopId);
  const shopIdx = i;
  i += 1;

  let where = `id = $${idIdx} AND shop_id = $${shopIdx}`;
  if (staff.kind === 'barber') {
    params.push(staff.id);
    where += ` AND barber_id = $${i}`;
    i += 1;
  }
  params.push(def.from);
  where += ` AND status = ANY($${i}::text[])`;

  const { rows } = await pool.query<BookingRow>(
    `UPDATE bookings SET ${sets.join(', ')} WHERE ${where} RETURNING ${RAW_COLS}`,
    params,
  );
  if (rows[0]) {
    // Review invitations hang off this (see notifications/reviewEmails.ts). The
    // 'from: confirmed' guard means a booking can only ever complete once.
    if (action === 'complete') eventBus.emit('booking.completed', { shopId, bookingId: id });
    return toBookingDTO(rows[0]);
  }

  // 0 rows updated — distinguish "not found / not yours" (404) from "wrong status" (409).
  const exParams: unknown[] = [id, shopId];
  let exWhere = 'id = $1 AND shop_id = $2';
  if (staff.kind === 'barber') {
    exParams.push(staff.id);
    exWhere += ' AND barber_id = $3';
  }
  const ex = await pool.query(`SELECT 1 FROM bookings WHERE ${exWhere}`, exParams);
  if ((ex.rowCount ?? 0) === 0) throw notFound('Booking not found');
  throw conflict('Invalid status transition');
}
