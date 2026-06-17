import type { Request, Response, NextFunction } from 'express';
import { extractBearerToken, verifyBarberToken } from '../../modules/auth/auth.middleware.js';

/**
 * Authorize a staff actor (shop owner via session OR barber via JWT) for the
 * tenant resolved by tenantResolver, and attach req.staff.
 *
 * SECURITY: FAIL-CLOSED.
 * - Must run AFTER tenantResolver (needs req.shop). Missing shop → 500.
 * - If an owner session exists it is used and MUST match req.shop.id, else 403 —
 *   no fall-through to barber JWT (at most one actor is ever resolved).
 * - A barber JWT must verify AND its shopId must match req.shop.id, else 401/403.
 */
export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  const shop = req.shop;
  if (!shop) {
    // Programming error: requireStaff mounted without tenantResolver.
    next(new Error('requireStaff requires tenantResolver to run first'));
    return;
  }

  const owner = req.session.owner;
  if (owner) {
    if (owner.shopId !== shop.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    req.staff = { kind: 'owner', id: owner.id, shopId: owner.shopId, name: owner.name };
    next();
    return;
  }

  const token = extractBearerToken(req);
  if (token) {
    const barber = verifyBarberToken(token);
    if (!barber) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (barber.shopId !== shop.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    req.staff = { kind: 'barber', id: barber.id, shopId: barber.shopId, name: barber.name };
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Owner-only variant for endpoints barbers must not touch (e.g. services CRUD).
 * SECURITY: fail-closed — requires an owner session whose shopId matches req.shop.id.
 */
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const shop = req.shop;
  if (!shop) {
    next(new Error('requireOwner requires tenantResolver to run first'));
    return;
  }
  const owner = req.session.owner;
  if (!owner) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (owner.shopId !== shop.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  req.staff = { kind: 'owner', id: owner.id, shopId: owner.shopId, name: owner.name };
  next();
}
