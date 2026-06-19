import type { Request } from 'express';
import type { StaffPrincipal } from './principal.js';

export interface ResolvedShop {
  id: string;
  slug: string;
  timezone: string;
  name: string | null;
}

/** Narrow req.shop to a guaranteed value. Throws (→500) if tenantResolver didn't run. */
export function getShop(req: Request): ResolvedShop {
  if (!req.shop) {
    throw new Error('Tenant not resolved — tenantResolver must run before this handler');
  }
  return req.shop;
}

/** Narrow req.staff to a guaranteed value. Throws (→500) if requireStaff/requireOwner didn't run. */
export function getStaff(req: Request): StaffPrincipal {
  if (!req.staff) {
    throw new Error('Staff not resolved — requireStaff must run before this handler');
  }
  return req.staff;
}
