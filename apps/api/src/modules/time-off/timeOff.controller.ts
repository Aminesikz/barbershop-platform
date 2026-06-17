import type { Request, Response } from 'express';
import { z } from 'zod';
import { getShop, getStaff } from '../../shared/reqContext.js';
import { assertCanManageBarber } from '../../shared/manageBarber.js';
import { notFound } from '../../shared/httpError.js';
import { isoDatetime } from '../../shared/validation.js';
import * as svc from './timeOff.service.js';

const barberParam = z.object({ barberId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({ from: isoDatetime.optional(), to: isoDatetime.optional() });

const createSchema = z
  .object({
    start: isoDatetime,
    end: isoDatetime,
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((b) => new Date(b.end).getTime() > new Date(b.start).getTime(), {
    message: 'end must be after start',
  });

export async function list(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const { barberId } = barberParam.parse(req.params);
  assertCanManageBarber(staff, barberId);
  if (!(await svc.isBarberActiveInShop(shop.id, barberId))) throw notFound('Barber not found');
  const { from, to } = listQuery.parse(req.query);
  res.json({ timeOff: await svc.listTimeOff(barberId, from, to) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const { barberId } = barberParam.parse(req.params);
  assertCanManageBarber(staff, barberId);
  const body = createSchema.parse(req.body);
  const timeOff = await svc.createTimeOff(shop.id, barberId, body.start, body.end, body.reason ?? null);
  res.status(201).json({ timeOff });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const { id } = idParam.parse(req.params);

  // Authorize BEFORE mutating: find owning barber, check permission + shop membership.
  const barberId = await svc.getTimeOffBarber(id);
  if (!barberId) throw notFound('Time off not found');
  assertCanManageBarber(staff, barberId);
  if (!(await svc.isBarberActiveInShop(shop.id, barberId))) throw notFound('Time off not found');

  const ok = await svc.deleteTimeOffById(id);
  if (!ok) throw notFound('Time off not found');
  res.status(204).send();
}
