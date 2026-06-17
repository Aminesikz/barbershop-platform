import { pool, withTransaction } from '../../config/db.js';
import { mapPgError } from '../../shared/pgErrors.js';
import { notFound } from '../../shared/httpError.js';
import type { WorkingHourDTO } from '@barber/shared-types';

interface WorkingHourRow {
  id: string;
  barber_id: string;
  weekday: number;
  start_min: number;
  end_min: number;
}

const COLS = 'id, barber_id, weekday, start_min, end_min';

function toDTO(r: WorkingHourRow): WorkingHourDTO {
  return { id: r.id, barberId: r.barber_id, weekday: r.weekday, startMin: r.start_min, endMin: r.end_min };
}

export interface WorkingHourEntry {
  weekday: number;
  startMin: number;
  endMin: number;
}

/** Returns null if the barber is not an active member of this shop (→ 404). */
export async function listWorkingHours(shopId: string, barberId: string): Promise<WorkingHourDTO[] | null> {
  const active = await pool.query(
    `SELECT 1 FROM barber_shops bs JOIN barbers b ON b.id = bs.barber_id
     WHERE bs.barber_id = $1 AND bs.shop_id = $2 AND bs.is_active AND b.is_active`,
    [barberId, shopId],
  );
  if (active.rowCount === 0) return null;

  const { rows } = await pool.query<WorkingHourRow>(
    `SELECT ${COLS} FROM working_hours WHERE shop_id = $1 AND barber_id = $2 ORDER BY weekday, start_min`,
    [shopId, barberId],
  );
  return rows.map(toDTO);
}

/**
 * Full-replace a barber's weekly schedule, atomically. Takes a per-barber row lock
 * so it serializes against concurrent replaces and booking-create on the same barber.
 * The DB no_overlapping_shift EXCLUDE is the backstop behind the Zod overlap check.
 */
export async function replaceWorkingHours(
  shopId: string,
  barberId: string,
  entries: WorkingHourEntry[],
): Promise<WorkingHourDTO[]> {
  try {
    return await withTransaction(async (client) => {
      // SECURITY/CONCURRENCY: lock the barber<->shop row; also asserts active membership.
      const lock = await client.query(
        `SELECT 1 FROM barber_shops WHERE barber_id = $1 AND shop_id = $2 AND is_active FOR UPDATE`,
        [barberId, shopId],
      );
      if (lock.rowCount === 0) throw notFound('Barber not found in this shop');

      await client.query(`DELETE FROM working_hours WHERE shop_id = $1 AND barber_id = $2`, [shopId, barberId]);

      for (const e of entries) {
        await client.query(
          `INSERT INTO working_hours (shop_id, barber_id, weekday, start_min, end_min)
           VALUES ($1, $2, $3, $4, $5)`,
          [shopId, barberId, e.weekday, e.startMin, e.endMin],
        );
      }

      const { rows } = await client.query<WorkingHourRow>(
        `SELECT ${COLS} FROM working_hours WHERE shop_id = $1 AND barber_id = $2 ORDER BY weekday, start_min`,
        [shopId, barberId],
      );
      return rows.map(toDTO);
    });
  } catch (err) {
    throw mapPgError(err) ?? err;
  }
}
