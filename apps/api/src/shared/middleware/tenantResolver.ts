import { Request, Response, NextFunction } from 'express';
import { pool } from '../../config/db.js';

interface ShopRow {
  id: string;
  slug: string;
  timezone: string;
  is_active: boolean;
}

function extractSlug(req: Request): string | null {
  const host = req.get('Host') ?? '';
  // "slug.platform.dz" → "slug"
  const parts = host.split('.');
  if (parts.length >= 3) {
    return parts[0] ?? null;
  }
  // Fallback for local dev / mobile clients
  return req.get('X-Shop-Slug') ?? null;
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
      'SELECT id, slug, timezone, is_active FROM shops WHERE slug = $1',
      [slug],
    );

    const shop = result.rows[0];

    if (!shop || !shop.is_active) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    req.shop = { id: shop.id, slug: shop.slug, timezone: shop.timezone };
    next();
  } catch (err) {
    // SECURITY: tenantResolver runs first on every /api request; Express 4 does not
    // catch async rejections, so forward DB errors to the central errorHandler.
    next(err);
  }
}
