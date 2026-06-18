import bcrypt from 'bcrypt';
import { pool, withTransaction } from '../../config/db.js';
import { mapPgError } from '../../shared/pgErrors.js';
import type { AdminShopDTO } from '@barber/shared-types';

// Cross-tenant: these queries are GLOBAL (no shop_id filter) because the platform
// admin operates above tenancy. Only reachable behind requirePlatformAdmin.

interface ShopRow {
  id: string;
  slug: string;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  owner_email: string | null;
}

function toDTO(r: ShopRow): AdminShopDTO {
  return {
    id: r.id,
    slug: r.slug,
    timezone: r.timezone,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
    ownerEmail: r.owner_email,
  };
}

const OWNER_EMAIL_SUBQUERY = `(
  SELECT o.email FROM shop_owners o
  WHERE o.shop_id = s.id AND o.is_active
  ORDER BY o.created_at LIMIT 1
)`;

export async function listShops(): Promise<AdminShopDTO[]> {
  const { rows } = await pool.query<ShopRow>(
    `SELECT s.id, s.slug, s.timezone, s.is_active, s.created_at, ${OWNER_EMAIL_SUBQUERY} AS owner_email
     FROM shops s ORDER BY s.created_at DESC`,
  );
  return rows.map(toDTO);
}

export interface CreateShopInput {
  slug: string;
  timezone: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
}

/** Create a shop AND its first owner atomically — a shop with no owner is unusable. */
export async function createShopWithOwner(input: CreateShopInput): Promise<AdminShopDTO> {
  try {
    return await withTransaction(async (client) => {
      const shopRes = await client.query<Omit<ShopRow, 'owner_email'>>(
        `INSERT INTO shops (slug, timezone) VALUES ($1, $2)
         RETURNING id, slug, timezone, is_active, created_at`,
        [input.slug, input.timezone],
      );
      const shop = shopRes.rows[0];
      if (!shop) throw new Error('shop INSERT returned no row');

      const passwordHash = await bcrypt.hash(input.ownerPassword, 12);
      await client.query(
        `INSERT INTO shop_owners (shop_id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
        [shop.id, input.ownerEmail, passwordHash, input.ownerName],
      );

      return toDTO({ ...shop, owner_email: input.ownerEmail });
    });
  } catch (err) {
    // 23505 on shops.slug or shop_owners.email → 409.
    throw mapPgError(err) ?? err;
  }
}

export interface UpdateShopInput {
  isActive?: boolean | undefined;
  timezone?: string | undefined;
}

export async function updateShop(id: string, patch: UpdateShopInput): Promise<AdminShopDTO | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.isActive !== undefined) {
    sets.push(`is_active = $${i}`);
    vals.push(patch.isActive);
    i += 1;
  }
  if (patch.timezone !== undefined) {
    sets.push(`timezone = $${i}`);
    vals.push(patch.timezone);
    i += 1;
  }
  if (sets.length === 0) return null;

  vals.push(id);
  const updated = await pool.query<Omit<ShopRow, 'owner_email'>>(
    `UPDATE shops SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, slug, timezone, is_active, created_at`,
    vals,
  );
  const shop = updated.rows[0];
  if (!shop) return null;

  const oe = await pool.query<{ email: string }>(
    `SELECT email FROM shop_owners WHERE shop_id = $1 AND is_active ORDER BY created_at LIMIT 1`,
    [id],
  );
  return toDTO({ ...shop, owner_email: oe.rows[0]?.email ?? null });
}
