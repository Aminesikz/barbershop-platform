import type { Request, Response } from 'express';
import { z } from 'zod';
import { getShop } from '../../shared/reqContext.js';
import { notFound } from '../../shared/httpError.js';
import * as svc from './barbers.service.js';

const createSchema = z
  .object({
    email: z.string().email().max(254),
    nameAr: z.string().trim().min(1).max(120),
    nameEn: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .transform((v) => v ?? null),
    password: z.string().min(8).max(200),
  })
  .strict();

const updateSchema = z.object({ isActive: z.boolean() }).strict();

const idParam = z.object({ id: z.string().uuid() });

/** Owner-only: every barber linked to the shop, incl. deactivated. */
export async function listAll(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  res.json({ barbers: await svc.listBarbersForOwner(shop.id) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const body = createSchema.parse(req.body);
  const barber = await svc.createBarber(shop.id, body);
  res.status(201).json({ barber });
}

/** Owner-only: deactivate / reactivate a barber's membership in this shop. */
export async function setActive(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { id } = idParam.parse(req.params);
  const { isActive } = updateSchema.parse(req.body);
  const barber = await svc.setBarberActive(shop.id, id, isActive);
  if (!barber) throw notFound('Barber not found');
  res.json({ barber });
}
