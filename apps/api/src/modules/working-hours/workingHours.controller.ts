import type { Request, Response } from 'express';
import { z } from 'zod';
import { getShop, getStaff } from '../../shared/reqContext.js';
import { assertCanManageBarber } from '../../shared/manageBarber.js';
import { notFound } from '../../shared/httpError.js';
import { weekday, startMinute, endMinute } from '../../shared/validation.js';
import * as svc from './workingHours.service.js';

const barberParam = z.object({ barberId: z.string().uuid() });

const entrySchema = z
  .object({ weekday, startMin: startMinute, endMin: endMinute })
  .refine((e) => e.endMin > e.startMin, { message: 'endMin must be greater than startMin' });

const putSchema = z
  .object({ entries: z.array(entrySchema).max(50) })
  .superRefine((val, ctx) => {
    // Per-weekday non-overlap (the DB EXCLUDE is the backstop; this gives a clean 400).
    const byDay = new Map<number, Array<{ startMin: number; endMin: number }>>();
    for (const e of val.entries) {
      const list = byDay.get(e.weekday) ?? [];
      list.push({ startMin: e.startMin, endMin: e.endMin });
      byDay.set(e.weekday, list);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => a.startMin - b.startMin);
      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1]!;
        const cur = list[i]!;
        if (cur.startMin < prev.endMin) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Overlapping shifts on the same weekday' });
          return;
        }
      }
    }
  });

export async function listPublic(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { barberId } = barberParam.parse(req.params);
  const workingHours = await svc.listWorkingHours(shop.id, barberId);
  if (workingHours === null) throw notFound('Barber not found');
  res.json({ workingHours });
}

export async function replace(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const { barberId } = barberParam.parse(req.params);
  assertCanManageBarber(staff, barberId);
  const { entries } = putSchema.parse(req.body);
  const workingHours = await svc.replaceWorkingHours(shop.id, barberId, entries);
  res.json({ workingHours });
}
