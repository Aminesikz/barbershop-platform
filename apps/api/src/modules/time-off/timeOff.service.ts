import { pool, withTransaction } from '../../config/db.js';
import { mapPgError } from '../../shared/pgErrors.js';
import { notFound } from '../../shared/httpError.js';
import type { TimeOffDTO } from '@barber/shared-types';

interface TimeOffRow {
  id: string;
  barber_id: string;
  start_at: Date;
  end_at: Date;
  reason: string | null;
}

function toDTO(r: TimeOffRow): TimeOffDTO {
  return {
    id: r.id,
    barberId: r.barber_id,
    start: r.start_at.toISOString(),
    end: r.end_at.toISOString(),
    reason: r.reason,
  };
}

export async function isBarberActiveInShop(shopId: string, barberId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM barber_shops bs JOIN barbers b ON b.id = bs.barber_id
     WHERE bs.barber_id = $1 AND bs.shop_id = $2 AND bs.is_active AND b.is_active`,
    [barberId, shopId],
  );
  return (rowCount ?? 0) > 0;
}

export async function listTimeOff(
  barberId: string,
  from?: string,
  to?: string,
): Promise<TimeOffDTO[]> {
  const params: unknown[] = [barberId];
  let where = 'barber_id = $1';
  if (from && to) {
    params.push(from, to);
    where += ` AND during && tstzrange($2::timestamptz, $3::timestamptz, '[)')`;
  }
  const { rows } = await pool.query<TimeOffRow>(
    `SELECT id, barber_id, lower(during) AS start_at, upper(during) AS end_at, reason
     FROM barber_time_off WHERE ${where} ORDER BY lower(during)`,
    params,
  );
  return rows.map(toDTO);
}

export async function createTimeOff(
  shopId: string,
  barberId: string,
  start: string,
  end: string,
  reason: string | null,
): Promise<TimeOffDTO> {
  try {
    return await withTransaction(async (client) => {
      // CONCURRENCY: per-barber lock; also asserts active shop membership.
      const lock = await client.query(
        `SELECT 1 FROM barber_shops WHERE barber_id = $1 AND shop_id = $2 AND is_active FOR UPDATE`,
        [barberId, shopId],
      );
      if (lock.rowCount === 0) throw notFound('Barber not found in this shop');

      const { rows } = await client.query<TimeOffRow>(
        `INSERT INTO barber_time_off (barber_id, during, reason)
         VALUES ($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4)
         RETURNING id, barber_id, lower(during) AS start_at, upper(during) AS end_at, reason`,
        [barberId, start, end, reason],
      );
      const row = rows[0];
      if (!row) throw new Error('INSERT did not return a row');
      return toDTO(row);
    });
  } catch (err) {
    // 23P01 on no_overlapping_time_off → 409.
    throw mapPgError(err) ?? err;
  }
}

/** Look up which barber a time-off row belongs to (authorize-before-delete). */
export async function getTimeOffBarber(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ barber_id: string }>(
    `SELECT barber_id FROM barber_time_off WHERE id = $1`,
    [id],
  );
  return rows[0]?.barber_id ?? null;
}

export async function deleteTimeOffById(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM barber_time_off WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
