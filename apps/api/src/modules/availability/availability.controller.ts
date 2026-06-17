import type { Request, Response } from 'express';
import { z } from 'zod';
import { getShop } from '../../shared/reqContext.js';
import { badRequest } from '../../shared/httpError.js';
import { env } from '../../config/env.js';
import { uuid, calendarDate } from '../../shared/validation.js';
import { getAvailability } from './availability.service.js';

const querySchema = z
  .object({ barberId: uuid, serviceId: uuid, date: calendarDate })
  .strict();

export async function read(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const { barberId, serviceId, date } = querySchema.parse(req.query);

  // Bound how far ahead slots can be queried (blunts day-by-day scraping). Past dates
  // simply yield no slots via the SQL now()-floor, so they need no explicit rejection.
  const maxDate = new Date();
  maxDate.setUTCDate(maxDate.getUTCDate() + env.BOOKING_HORIZON_DAYS);
  if (new Date(`${date}T00:00:00Z`).getTime() > maxDate.getTime()) {
    throw badRequest('Date is beyond the booking horizon');
  }

  res.json(await getAvailability(shop, barberId, serviceId, date));
}
