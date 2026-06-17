import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { verifyOwnerCredentials, verifyBarberCredentials } from './auth.service.js';
import { env } from '../../config/env.js';

const ownerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const barberLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  shopId: z.string().uuid(),
});

export async function ownerLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = ownerLoginSchema.parse(req.body);
    const result = await verifyOwnerCredentials(body.email, body.password);

    if (!result) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    req.session.owner = { id: result.id, shopId: result.shopId, name: result.name };

    // Cookie settings are applied via session middleware config in app.ts
    res.json({ name: result.name, shopId: result.shopId });
  } catch (err) {
    next(err);
  }
}

export async function ownerLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
  req.session.destroy((err) => {
    if (err) {
      next(err);
      return;
    }
    res.clearCookie('sid', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    res.status(204).send();
  });
}

export function ownerMe(req: Request, res: Response): void {
  // requireOwnerSession middleware guarantees session.owner is set
  res.json(req.session.owner);
}

export async function barberLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = barberLoginSchema.parse(req.body);
    const result = await verifyBarberCredentials(body.email, body.password, body.shopId);

    if (!result) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export function barberMe(req: Request, res: Response): void {
  // requireBarberJWT middleware guarantees req.barber is set
  res.json(req.barber);
}
