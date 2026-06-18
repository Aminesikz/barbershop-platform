import bcrypt from 'bcrypt';
import { pool, withTransaction } from '../../config/db.js';
import { mapPgError, pgErrorCode } from '../../shared/pgErrors.js';
import { conflict } from '../../shared/httpError.js';
import type { BarberDTO, BarberAdminDTO } from '@barber/shared-types';

interface BarberRow {
  id: string;
  name_ar: string;
  name_en: string | null;
}

/** Active barbers in a shop. Exposes id + names only (no email/PII). */
export async function listActiveBarbers(shopId: string): Promise<BarberDTO[]> {
  const { rows } = await pool.query<BarberRow>(
    `SELECT b.id, b.name_ar, b.name_en
     FROM barbers b
     JOIN barber_shops bs ON bs.barber_id = b.id
     WHERE bs.shop_id = $1 AND bs.is_active AND b.is_active
     ORDER BY b.name_ar`,
    [shopId],
  );
  return rows.map((r) => ({ id: r.id, nameAr: r.name_ar, nameEn: r.name_en }));
}

// ---------------------------------------------------------------------------
// Owner management (requireOwner). Exposes email + the per-shop active flag.
// ---------------------------------------------------------------------------

interface BarberAdminRow {
  id: string;
  email: string;
  name_ar: string;
  name_en: string | null;
  is_active: boolean; // barber_shops.is_active for the queried shop
  created_at: Date;
}

const ADMIN_COLS = 'b.id, b.email, b.name_ar, b.name_en, bs.is_active, b.created_at';

function toAdminDTO(r: BarberAdminRow): BarberAdminDTO {
  return {
    id: r.id,
    email: r.email,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
  };
}

/** Every barber linked to a shop, INCLUDING deactivated memberships. Owner-only. */
export async function listBarbersForOwner(shopId: string): Promise<BarberAdminDTO[]> {
  const { rows } = await pool.query<BarberAdminRow>(
    `SELECT ${ADMIN_COLS}
     FROM barbers b
     JOIN barber_shops bs ON bs.barber_id = b.id
     WHERE bs.shop_id = $1
     ORDER BY bs.is_active DESC, b.name_ar`,
    [shopId],
  );
  return rows.map(toAdminDTO);
}

export interface CreateBarberInput {
  email: string;
  nameAr: string;
  nameEn: string | null;
  password: string;
}

/**
 * Create a new barber person AND link them to the owner's shop atomically — a
 * barber with no shop membership is unusable. The email is globally UNIQUE; a
 * collision means the barber already exists (→ 409).
 */
export async function createBarber(shopId: string, input: CreateBarberInput): Promise<BarberAdminDTO> {
  try {
    return await withTransaction(async (client) => {
      const passwordHash = await bcrypt.hash(input.password, 12);
      const res = await client.query<Omit<BarberAdminRow, 'is_active'>>(
        `INSERT INTO barbers (email, password_hash, name_ar, name_en)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name_ar, name_en, created_at`,
        [input.email, passwordHash, input.nameAr, input.nameEn],
      );
      const barber = res.rows[0];
      if (!barber) throw new Error('barber INSERT returned no row');

      await client.query(
        `INSERT INTO barber_shops (barber_id, shop_id) VALUES ($1, $2)`,
        [barber.id, shopId],
      );

      return toAdminDTO({ ...barber, is_active: true });
    });
  } catch (err) {
    // 23505 on barbers.email → the barber already exists.
    if (pgErrorCode(err) === '23505') throw conflict('A barber with this email already exists');
    throw mapPgError(err) ?? err;
  }
}

/**
 * Toggle a barber's membership in this shop (barber_shops.is_active). Deactivating
 * removes them from the public/bookable list and blocks new barber logins
 * (verifyBarberCredentials checks this flag). Returns null if no such membership.
 */
export async function setBarberActive(
  shopId: string,
  barberId: string,
  isActive: boolean,
): Promise<BarberAdminDTO | null> {
  const { rows } = await pool.query<BarberAdminRow>(
    `WITH upd AS (
       UPDATE barber_shops SET is_active = $1
       WHERE shop_id = $2 AND barber_id = $3
       RETURNING barber_id, is_active
     )
     SELECT b.id, b.email, b.name_ar, b.name_en, upd.is_active, b.created_at
     FROM upd JOIN barbers b ON b.id = upd.barber_id`,
    [isActive, shopId, barberId],
  );
  return rows[0] ? toAdminDTO(rows[0]) : null;
}
