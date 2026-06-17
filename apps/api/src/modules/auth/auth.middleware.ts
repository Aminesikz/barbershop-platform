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

export function requireOwnerSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.owner) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export function requireBarberJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (!isJwtPayload(decoded)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.barber = { id: decoded.sub, shopId: decoded.shopId, name: decoded.name };
    next();
  } catch {
    // SECURITY: any jwt error (expired, tampered, invalid sig) → 401, no details leaked
    res.status(401).json({ error: 'Unauthorized' });
  }
}
