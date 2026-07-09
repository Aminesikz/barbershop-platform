import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { verifyAdminCredentials } from './admin.auth.service.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) }).strict();

export async function adminLogin(req: Request, res: Response): Promise<void> {
  const body = loginSchema.parse(req.body);
  const result = await verifyAdminCredentials(body.email, body.password);
  if (!result) {
    // Generic message — never reveal whether the email exists.
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  // SECURITY: rotate the session id at the privilege boundary (session fixation).
  // Also drops any lower-privilege principal (e.g. shop owner) riding the same sid.
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  req.session.platformAdmin = { id: result.id, name: result.name };
  res.json({ name: result.name });
}

export function adminLogout(req: Request, res: Response, next: NextFunction): void {
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

export function adminMe(req: Request, res: Response): void {
  // requirePlatformAdmin guarantees session.platformAdmin is set.
  res.json(req.session.platformAdmin);
}
