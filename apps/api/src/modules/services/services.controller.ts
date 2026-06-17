import type { Request, Response } from 'express';
import { z } from 'zod';
import { getShop } from '../../shared/reqContext.js';
import { notFound } from '../../shared/httpError.js';
import * as svc from './services.service.js';

const createSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(120),
    nameEn: z.string().trim().max(120).nullish().transform((v) => v ?? null),
    durationMin: z.number().int().min(5).max(480),
    priceDzd: z.number().int().min(0),
  })
  .strict();

const updateSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(120).optional(),
    nameEn: z.string().trim().max(120).nullable().optional(),
    durationMin: z.number().int().min(5).max(480).optional(),
    priceDzd: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' });

const idParam = z.object({ id: z.string().uuid() });
const allQuery = z.object({ includeInactive: z.coerce.boolean().optional() });

export async function listPublic(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  res.json({ services: await svc.listActiveServices(shop.id) });
}

export async function listAll(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { includeInactive } = allQuery.parse(req.query);
  res.json({ services: await svc.listAllServices(shop.id, includeInactive ?? false) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const body = createSchema.parse(req.body);
  const service = await svc.createService(shop.id, body);
  res.status(201).json({ service });
}

export async function update(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { id } = idParam.parse(req.params);
  const patch = updateSchema.parse(req.body);
  const service = await svc.updateService(shop.id, id, patch);
  if (!service) throw notFound('Service not found');
  res.json({ service });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { id } = idParam.parse(req.params);
  const ok = await svc.softDeleteService(shop.id, id);
  if (!ok) throw notFound('Service not found');
  res.status(204).send();
}
