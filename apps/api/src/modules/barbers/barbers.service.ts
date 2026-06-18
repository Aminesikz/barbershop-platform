import { pool } from '../../config/db.js';
import type { BarberDTO } from '@barber/shared-types';

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
