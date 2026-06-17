import { pool } from '../../config/db.js';
import { mapPgError } from '../../shared/pgErrors.js';
import type { ServiceDTO } from '@barber/shared-types';

// SECURITY: every query is scoped WHERE shop_id = $1 for tenant isolation.

interface ServiceRow {
  id: string;
  shop_id: string;
  name_ar: string;
  name_en: string | null;
  duration_min: number;
  price_dzd: number;
  is_active: boolean;
}

const COLS = 'id, shop_id, name_ar, name_en, duration_min, price_dzd, is_active';

function toDTO(r: ServiceRow): ServiceDTO {
  return {
    id: r.id,
    shopId: r.shop_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    durationMin: r.duration_min,
    priceDzd: r.price_dzd,
    isActive: r.is_active,
  };
}

export async function listActiveServices(shopId: string): Promise<ServiceDTO[]> {
  const { rows } = await pool.query<ServiceRow>(
    `SELECT ${COLS} FROM services WHERE shop_id = $1 AND is_active ORDER BY name_ar`,
    [shopId],
  );
  return rows.map(toDTO);
}

export async function listAllServices(shopId: string, includeInactive: boolean): Promise<ServiceDTO[]> {
  const sql = includeInactive
    ? `SELECT ${COLS} FROM services WHERE shop_id = $1 ORDER BY is_active DESC, name_ar`
    : `SELECT ${COLS} FROM services WHERE shop_id = $1 AND is_active ORDER BY name_ar`;
  const { rows } = await pool.query<ServiceRow>(sql, [shopId]);
  return rows.map(toDTO);
}

export interface CreateServiceInput {
  nameAr: string;
  nameEn: string | null;
  durationMin: number;
  priceDzd: number;
}

export async function createService(shopId: string, input: CreateServiceInput): Promise<ServiceDTO> {
  try {
    const { rows } = await pool.query<ServiceRow>(
      `INSERT INTO services (shop_id, name_ar, name_en, duration_min, price_dzd)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
      [shopId, input.nameAr, input.nameEn, input.durationMin, input.priceDzd],
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT did not return a row');
    return toDTO(row);
  } catch (err) {
    // 23505 on uq_services_shop_name_active → 409 duplicate active name.
    throw mapPgError(err) ?? err;
  }
}

export interface UpdateServiceInput {
  nameAr?: string | undefined;
  nameEn?: string | null | undefined;
  durationMin?: number | undefined;
  priceDzd?: number | undefined;
  isActive?: boolean | undefined;
}

const UPDATE_COLS: ReadonlyArray<[keyof UpdateServiceInput, string]> = [
  ['nameAr', 'name_ar'],
  ['nameEn', 'name_en'],
  ['durationMin', 'duration_min'],
  ['priceDzd', 'price_dzd'],
  ['isActive', 'is_active'],
];

export async function updateService(
  shopId: string,
  id: string,
  patch: UpdateServiceInput,
): Promise<ServiceDTO | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [key, col] of UPDATE_COLS) {
    const value = patch[key];
    if (value !== undefined) {
      sets.push(`${col} = $${i}`);
      vals.push(value);
      i += 1;
    }
  }
  if (sets.length === 0) return null; // guarded by Zod refine; defensive

  vals.push(shopId, id);
  try {
    const { rows } = await pool.query<ServiceRow>(
      `UPDATE services SET ${sets.join(', ')} WHERE shop_id = $${i} AND id = $${i + 1} RETURNING ${COLS}`,
      vals,
    );
    return rows[0] ? toDTO(rows[0]) : null;
  } catch (err) {
    throw mapPgError(err) ?? err;
  }
}

/** Soft delete. Returns false if no such service in this shop. */
export async function softDeleteService(shopId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE services SET is_active = false WHERE shop_id = $1 AND id = $2`,
    [shopId, id],
  );
  return (rowCount ?? 0) > 0;
}
