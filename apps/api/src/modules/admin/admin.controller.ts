import type { Request, Response } from 'express';
import { z } from 'zod';
import { notFound } from '../../shared/httpError.js';
import * as svc from './admin.service.js';

const createShopSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers and hyphens'),
    name: z.string().trim().min(2).max(120),
    timezone: z.string().min(1).max(64).optional(),
    ownerEmail: z.string().email(),
    ownerName: z.string().trim().min(2).max(100),
    ownerPassword: z.string().min(8).max(200),
  })
  .strict();

const updateShopSchema = z
  .object({
    isActive: z.boolean().optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' });

const idParam = z.object({ id: z.string().uuid() });

export async function listShops(_req: Request, res: Response): Promise<void> {
  res.json({ shops: await svc.listShops() });
}

export async function createShop(req: Request, res: Response): Promise<void> {
  const b = createShopSchema.parse(req.body);
  const shop = await svc.createShopWithOwner({
    slug: b.slug,
    name: b.name,
    timezone: b.timezone ?? 'Africa/Algiers',
    ownerEmail: b.ownerEmail,
    ownerName: b.ownerName,
    ownerPassword: b.ownerPassword,
  });
  res.status(201).json({ shop });
}

export async function updateShop(req: Request, res: Response): Promise<void> {
  const { id } = idParam.parse(req.params);
  const patch = updateShopSchema.parse(req.body);
  const shop = await svc.updateShop(id, patch);
  if (!shop) throw notFound('Shop not found');
  res.json({ shop });
}
