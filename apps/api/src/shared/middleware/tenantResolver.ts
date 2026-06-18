import { Request, Response, NextFunction } from 'express';
import { pool } from '../../config/db.js';

interface ShopRow {
  id: string;
  slug: string;
  timezone: string;
  name: string | null;
  is_active: boolean;
}

// Subdomains that are NOT a shop slug (the API host, marketing, the admin app, etc.).
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api']);

function extractSlug(req: Request): string | null {
  // Explicit header wins. The frontend always sets X-Shop-Slug from its OWN hostname,
  // and in the split deploy (frontend at slug.platform.dz, API at api.platform.dz) the
  // Host seen here is the API's host, not the shop's — so the header is the truth.
  const header = req.get('X-Shop-Slug')?.trim();
  if (header) return header;

  // Otherwise derive from the Host subdomain ("slug.platform.dz" → "slug"), skipping
  // reserved labels and the bare apex.
  const host = (req.get('Host') ?? '').split(':')[0] ?? '';
  const parts = host.split('.');
  if (parts.length >= 3) {
    const sub = parts[0] ?? '';
    if (sub && !RESERVED_SUBDOMAINS.has(sub)) return sub;
  }
  return null;
}

export async function tenantResolver(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const slug = extractSlug(req);

    if (!slug) {
      res.status(400).json({ error: 'Shop slug could not be determined' });
      return;
    }

    const result = await pool.query<ShopRow>(
      'SELECT id, slug, timezone, name, is_active FROM shops WHERE slug = $1',
      [slug],
    );

    const shop = result.rows[0];

    if (!shop || !shop.is_active) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    req.shop = { id: shop.id, slug: shop.slug, timezone: shop.timezone, name: shop.name };
    next();
  } catch (err) {
    // SECURITY: tenantResolver runs first on every /api request; Express 4 does not
    // catch async rejections, so forward DB errors to the central errorHandler.
    next(err);
  }
}
