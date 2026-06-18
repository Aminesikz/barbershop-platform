import type { Request, Response, NextFunction } from 'express';

/**
 * SECURITY: fail-closed platform-admin guard. Reads ONLY req.session.platformAdmin —
 * never falls through to owner/barber auth, and these routes never run tenantResolver
 * (no req.shop). An owner/barber session can never satisfy this.
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.platformAdmin) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
