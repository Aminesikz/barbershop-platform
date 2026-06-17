import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

interface JwtPayload {
  sub: string;
  shopId: string;
  name: string;
}

function isJwtPayload(v: unknown): v is JwtPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['sub'] === 'string' &&
    typeof (v as Record<string, unknown>)['shopId'] === 'string' &&
    typeof (v as Record<string, unknown>)['name'] === 'string'
  );
}

export interface BarberPrincipal {
  id: string;
  shopId: string;
  name: string;
}

/** Pull the bearer token out of the Authorization header, or null. */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/**
 * Verify a barber JWT and return the principal, or null on ANY failure
 * (expired, tampered, wrong secret, malformed payload). Shared by requireBarberJWT
 * and requireStaff so the verification rules can't drift apart.
 */
export function verifyBarberToken(token: string): BarberPrincipal | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (!isJwtPayload(decoded)) return null;
    return { id: decoded.sub, shopId: decoded.shopId, name: decoded.name };
  } catch {
    return null;
  }
}

export function requireOwnerSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.owner) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export function requireBarberJWT(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const barber = verifyBarberToken(token);
  if (!barber) {
    // SECURITY: any jwt error (expired, tampered, invalid sig) → 401, no details leaked
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.barber = barber;
  next();
}
