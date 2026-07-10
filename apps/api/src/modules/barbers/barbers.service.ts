import bcrypt from 'bcrypt';
import { pool, withTransaction } from '../../config/db.js';
import { mapPgError, pgErrorCode } from '../../shared/pgErrors.js';
import { conflict } from '../../shared/httpError.js';
import type { BarberDTO, BarberAdminDTO } from '@barber/shared-types';

interface BarberRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  role_title: string | null;
  specialty: string | null;
  bio: string | null;
}

/** Active barbers in a shop. Exposes id + names + public profile (no email/PII). */
export async function listActiveBarbers(shopId: string): Promise<BarberDTO[]> {
  const { rows } = await pool.query<BarberRow>(
    `SELECT b.id, b.name_ar, b.name_en, b.role_title, b.specialty, b.bio
     FROM barbers b
     JOIN barber_shops bs ON bs.barber_id = b.id
     WHERE bs.shop_id = $1 AND bs.is_active AND b.is_active
     ORDER BY b.name_ar`,
    [shopId],
  );
  return rows.map((r) => ({
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    role: r.role_title,
    specialty: r.specialty,
    bio: r.bio,
  }));
}

// ---------------------------------------------------------------------------
// Owner management (requireOwner). Exposes email + the per-shop active flag.
// ---------------------------------------------------------------------------

interface BarberAdminRow {
  id: string;
  email: string;
  name_ar: string;
  name_en: string | null;
  role_title: string | null;
  specialty: string | null;
  bio: string | null;
  is_active: boolean; // barber_shops.is_active for the queried shop
  created_at: Date;
}

const ADMIN_COLS =
  'b.id, b.email, b.name_ar, b.name_en, b.role_title, b.specialty, b.bio, bs.is_active, b.created_at';

function toAdminDTO(r: BarberAdminRow): BarberAdminDTO {
  return {
    id: r.id,
    email: r.email,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    role: r.role_title,
    specialty: r.specialty,
    bio: r.bio,
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
  role: string | null;
  specialty: string | null;
  bio: string | null;
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
        `INSERT INTO barbers (email, password_hash, name_ar, name_en, role_title, specialty, bio)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, name_ar, name_en, role_title, specialty, bio, created_at`,
        [input.email, passwordHash, input.nameAr, input.nameEn, input.role, input.specialty, input.bio],
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

export interface UpdateBarberInput {
  /** barber_shops.is_active for THIS shop (membership toggle). */
  isActive?: boolean | undefined;
  // Person-level public profile. undefined = leave unchanged; null = clear.
  role?: string | null | undefined;
  specialty?: string | null | undefined;
  bio?: string | null | undefined;
}

/**
 * Owner update of a barber: membership toggle (barber_shops.is_active) and/or the
 * public profile (role/specialty/bio on the person). The membership row is locked
 * first — it both scopes the update to this shop (404 when the barber isn't
 * linked here) and serializes concurrent edits. Returns null if no membership.
 */
export async function updateBarber(
  shopId: string,
  barberId: string,
  patch: UpdateBarberInput,
): Promise<BarberAdminDTO | null> {
  return withTransaction(async (client) => {
    const mem = await client.query(
      `SELECT 1 FROM barber_shops WHERE barber_id = $1 AND shop_id = $2 FOR UPDATE`,
      [barberId, shopId],
    );
    if (mem.rowCount === 0) return null;

    if (patch.isActive !== undefined) {
      await client.query(
        `UPDATE barber_shops SET is_active = $1 WHERE barber_id = $2 AND shop_id = $3`,
        [patch.isActive, barberId, shopId],
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const profileCols: Array<[string, string | null | undefined]> = [
      ['role_title', patch.role],
      ['specialty', patch.specialty],
      ['bio', patch.bio],
    ];
    for (const [col, val] of profileCols) {
      if (val !== undefined) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length > 0) {
      params.push(barberId);
      await client.query(`UPDATE barbers SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }

    const { rows } = await client.query<BarberAdminRow>(
      `SELECT ${ADMIN_COLS}
       FROM barbers b
       JOIN barber_shops bs ON bs.barber_id = b.id AND bs.shop_id = $2
       WHERE b.id = $1`,
      [barberId, shopId],
    );
    return rows[0] ? toAdminDTO(rows[0]) : null;
  });
}
