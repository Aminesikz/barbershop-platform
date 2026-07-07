import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redis } from '../../config/redis.js';
import { getShop, getStaff } from '../../shared/reqContext.js';
import { tooManyRequests } from '../../shared/httpError.js';
import { hmacPhone } from '../../shared/phone.js';
import { uuid, isoDatetime, customerName, algerianPhone, emailAddress } from '../../shared/validation.js';
import type { PublicBookingDTO } from '@barber/shared-types';
import * as svc from './bookings.service.js';

const createSchema = z
  .object({
    barberId: uuid,
    serviceId: uuid,
    start: isoDatetime,
    customerName,
    customerPhone: algerianPhone, // transforms → E.164
    customerEmail: emailAddress.optional(), // used for the confirmation email only
    idempotencyKey: uuid,
    website: z.string().optional(), // honeypot — accept ANY value (never .max(0), which would leak the trap)
  })
  .strict();

const listQuery = z
  .object({
    from: isoDatetime.optional(),
    to: isoDatetime.optional(),
    barberId: uuid.optional(),
    status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

const idParam = z.object({ id: uuid });
const cancelBody = z.object({ reason: z.string().trim().max(200).optional() }).strict();

function fabricateHoneypotResponse(start: string): PublicBookingDTO {
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  return {
    id: randomUUID(),
    status: 'pending',
    start,
    end,
    barber: { nameAr: '', nameEn: null },
    service: { nameAr: '', nameEn: null },
  };
}

export async function create(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const body = createSchema.parse(req.body);

  // SECURITY: honeypot — a real client never fills the hidden 'website' field. Bots that do
  // get a fabricated 201 and nothing is persisted or broadcast.
  if (body.website && body.website.trim().length > 0) {
    res.status(201).json({ booking: fabricateHoneypotResponse(body.start) });
    return;
  }

  // SECURITY: per-(shop + phone) cap on top of the per-IP limiter. Keyed on the HMAC,
  // never the raw number. Generic 429, no counts leaked.
  const phoneHmac = hmacPhone(body.customerPhone);
  const capKey = `rl:book-phone:${shop.id}:${phoneHmac}`;
  const count = await redis.incr(capKey);
  if (count === 1) await redis.expire(capKey, 3600);
  if (count > 3) throw tooManyRequests('Too many booking attempts, please try again later');

  const booking = await svc.createBooking(shop, {
    barberId: body.barberId,
    serviceId: body.serviceId,
    start: body.start,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    customerPhoneHmac: phoneHmac,
    customerEmail: body.customerEmail ?? null,
    idempotencyKey: body.idempotencyKey,
  });
  res.status(201).json({ booking });
}

export async function list(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const q = listQuery.parse(req.query);
  res.json({ bookings: await svc.listBookings(shop.id, staff, q) });
}

export async function confirm(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const { id } = idParam.parse(req.params);
  res.json({ booking: await svc.transitionBooking(shop.id, staff, id, 'confirm') });
}

export async function complete(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const { id } = idParam.parse(req.params);
  res.json({ booking: await svc.transitionBooking(shop.id, staff, id, 'complete') });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const { id } = idParam.parse(req.params);
  const { reason } = cancelBody.parse(req.body);
  res.json({ booking: await svc.transitionBooking(shop.id, staff, id, 'cancel', reason ?? null) });
}

export async function noShow(req: Request, res: Response): Promise<void> {
  const shop = getShop(req);
  const staff = getStaff(req);
  const { id } = idParam.parse(req.params);
  res.json({ booking: await svc.transitionBooking(shop.id, staff, id, 'no_show') });
}
