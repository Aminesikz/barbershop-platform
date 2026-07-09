import crypto from 'node:crypto';
import { pool, withTransaction } from '../../config/db.js';
import { badRequest, notFound } from '../../shared/httpError.js';
import { mapPgError } from '../../shared/pgErrors.js';
import type {
  PublicReviewDTO,
  ReviewAdminDTO,
  ReviewContextDTO,
  ReviewStatus,
  ReviewSummaryDTO,
} from '@barber/shared-types';
import {
  type ReviewAdminRow,
  type ReviewRow,
  toPublicReviewDTO,
  toReviewAdminDTO,
} from './reviews.mapper.js';

// SECURITY: raw tokens exist only in the review-invitation email. The DB stores a
// SHA-256 hash (same pattern as password_reset_tokens), single-use via used_at.
// Customers review at their own pace, so the TTL is generous.
const TOKEN_TTL_DAYS = 30;

/** How many approved reviews the public page shows (newest first). */
const PUBLIC_LIST_LIMIT = 30;

const REVIEW_COLS = `id, booking_id, barber_id, customer_name, rating, comment, status, created_at, moderated_at`;

// One static message for every token failure mode — a probe can't distinguish
// "never existed" from "expired" from "already used".
const INVALID_TOKEN_MSG = 'Invalid or expired review link';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Issue the one-time review token for a completed booking. Returns the RAW token
 * (caller emails it, never logs it), or null when one was already issued — the
 * ON CONFLICT guard makes a replayed 'booking.completed' event a no-op.
 */
export async function issueReviewToken(shopId: string, bookingId: string): Promise<string | null> {
  const token = crypto.randomBytes(32).toString('base64url');
  const { rowCount } = await pool.query(
    `INSERT INTO review_tokens (shop_id, booking_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))
     ON CONFLICT (booking_id) DO NOTHING`,
    [shopId, bookingId, hashToken(token), TOKEN_TTL_DAYS],
  );
  return (rowCount ?? 0) > 0 ? token : null;
}

interface ContextRow {
  customer_name: string;
  start_at: Date;
  barber_name_ar: string;
  barber_name_en: string | null;
  service_name_ar: string;
  service_name_en: string | null;
}

const CONTEXT_SQL = `
  SELECT b.customer_name, lower(b.during) AS start_at,
         ba.name_ar AS barber_name_ar, ba.name_en AS barber_name_en,
         se.name_ar AS service_name_ar, se.name_en AS service_name_en
  FROM review_tokens t
  JOIN bookings b ON b.id = t.booking_id
  JOIN barbers ba ON ba.id = b.barber_id
  JOIN services se ON se.id = b.service_id
  WHERE t.token_hash = $1 AND t.shop_id = $2
    AND t.used_at IS NULL AND t.expires_at > now()`;

/** What the /review landing page shows before the customer rates their visit. */
export async function getReviewContext(shopId: string, token: string): Promise<ReviewContextDTO> {
  const { rows } = await pool.query<ContextRow>(CONTEXT_SQL, [hashToken(token), shopId]);
  const row = rows[0];
  if (!row) throw badRequest(INVALID_TOKEN_MSG);
  return {
    customerName: row.customer_name,
    start: row.start_at.toISOString(),
    barber: { nameAr: row.barber_name_ar, nameEn: row.barber_name_en },
    service: { nameAr: row.service_name_ar, nameEn: row.service_name_en },
  };
}

export interface SubmitReviewInput {
  token: string;
  rating: number;
  comment: string | null;
}

/**
 * Consume a review token and create the (pending) review. The token row is locked
 * FOR UPDATE so a double-submit can't consume it twice; UNIQUE(booking_id) on
 * reviews is the DB backstop for one-review-per-booking.
 */
export async function submitReview(
  shopId: string,
  input: SubmitReviewInput,
): Promise<PublicReviewDTO> {
  try {
    return await withTransaction(async (client) => {
      const found = await client.query<{
        id: string;
        booking_id: string;
        expired_or_used: boolean;
      }>(
        `SELECT id, booking_id, (used_at IS NOT NULL OR expires_at <= now()) AS expired_or_used
         FROM review_tokens
         WHERE token_hash = $1 AND shop_id = $2
         FOR UPDATE`,
        [hashToken(input.token), shopId],
      );
      const tok = found.rows[0];
      if (!tok || tok.expired_or_used) throw badRequest(INVALID_TOKEN_MSG);

      const ins = await client.query<ReviewRow>(
        `INSERT INTO reviews (shop_id, booking_id, barber_id, customer_name, rating, comment)
         SELECT b.shop_id, b.id, b.barber_id, b.customer_name, $2, $3
         FROM bookings b
         WHERE b.id = $1 AND b.shop_id = $4
         RETURNING ${REVIEW_COLS}`,
        [tok.booking_id, input.rating, input.comment, shopId],
      );
      const row = ins.rows[0];
      if (!row) throw badRequest(INVALID_TOKEN_MSG); // booking vanished

      await client.query('UPDATE review_tokens SET used_at = now() WHERE id = $1', [tok.id]);
      return toPublicReviewDTO(row);
    });
  } catch (err) {
    // 23505 on reviews.booking_id: a review already exists for this booking.
    throw mapPgError(err) ?? err;
  }
}

interface SummaryRow {
  average: string | null; // numeric comes back as text from pg
  count: string;
}

interface BarberSummaryRow extends SummaryRow {
  barber_id: string;
}

/** Approved reviews (newest first) + rating aggregates for the public page. */
export async function listPublicReviews(
  shopId: string,
): Promise<{ summary: ReviewSummaryDTO; reviews: PublicReviewDTO[] }> {
  const [listRes, totalRes, byBarberRes] = await Promise.all([
    pool.query<ReviewRow>(
      `SELECT ${REVIEW_COLS} FROM reviews
       WHERE shop_id = $1 AND status = 'approved'
       ORDER BY created_at DESC LIMIT $2`,
      [shopId, PUBLIC_LIST_LIMIT],
    ),
    pool.query<SummaryRow>(
      `SELECT round(avg(rating)::numeric, 1) AS average, count(*) AS count
       FROM reviews WHERE shop_id = $1 AND status = 'approved'`,
      [shopId],
    ),
    pool.query<BarberSummaryRow>(
      `SELECT barber_id, round(avg(rating)::numeric, 1) AS average, count(*) AS count
       FROM reviews WHERE shop_id = $1 AND status = 'approved'
       GROUP BY barber_id`,
      [shopId],
    ),
  ]);

  const total = totalRes.rows[0];
  const summary: ReviewSummaryDTO = {
    average: total?.average != null ? Number(total.average) : null,
    count: total ? Number(total.count) : 0,
    barbers: byBarberRes.rows.map((r) => ({
      barberId: r.barber_id,
      average: Number(r.average),
      count: Number(r.count),
    })),
  };
  return { summary, reviews: listRes.rows.map(toPublicReviewDTO) };
}

/** Owner moderation list — every status, newest first. */
export async function listAllReviews(
  shopId: string,
  status?: ReviewStatus,
): Promise<ReviewAdminDTO[]> {
  const params: unknown[] = [shopId];
  let where = 'r.shop_id = $1';
  if (status) {
    params.push(status);
    where += ' AND r.status = $2';
  }
  const { rows } = await pool.query<ReviewAdminRow>(
    `SELECT r.id, r.booking_id, r.barber_id, r.customer_name, r.rating, r.comment,
            r.status, r.created_at, r.moderated_at,
            ba.name_ar AS barber_name_ar, ba.name_en AS barber_name_en
     FROM reviews r
     JOIN barbers ba ON ba.id = r.barber_id
     WHERE ${where}
     ORDER BY r.created_at DESC
     LIMIT 200`,
    params,
  );
  return rows.map(toReviewAdminDTO);
}

/** Owner decision: approve (publish) or reject (hide). Reversible either way. */
export async function moderateReview(
  shopId: string,
  id: string,
  status: 'approved' | 'rejected',
): Promise<ReviewAdminDTO> {
  const { rows } = await pool.query<ReviewAdminRow>(
    `UPDATE reviews r SET status = $1, moderated_at = now()
     FROM barbers ba
     WHERE r.id = $2 AND r.shop_id = $3 AND ba.id = r.barber_id
     RETURNING r.id, r.booking_id, r.barber_id, r.customer_name, r.rating, r.comment,
               r.status, r.created_at, r.moderated_at,
               ba.name_ar AS barber_name_ar, ba.name_en AS barber_name_en`,
    [status, id, shopId],
  );
  const row = rows[0];
  if (!row) throw notFound('Review not found');
  return toReviewAdminDTO(row);
}
