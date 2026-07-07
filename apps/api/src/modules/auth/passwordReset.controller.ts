import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestPasswordReset, performPasswordReset } from './passwordReset.service.js';
import type { ResetKind } from './passwordReset.service.js';
import { isEmailConfigured } from '../../shared/email.js';
import { serviceUnavailable } from '../../shared/httpError.js';

const forgotSchema = z
  .object({
    email: z.string().email().max(254),
  })
  .strict();

const resetSchema = z
  .object({
    token: z.string().min(20).max(200),
    // bcrypt truncates beyond 72 bytes, so longer passwords would silently weaken.
    password: z.string().min(8).max(72),
  })
  .strict();

function forgotHandler(kind: ResetKind) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!isEmailConfigured()) {
      throw serviceUnavailable('Password reset is temporarily unavailable');
    }
    const body = forgotSchema.parse(req.body);

    await requestPasswordReset(kind, body.email);

    // Always 202 — the response must not reveal whether the email exists.
    res.status(202).json({ message: 'If that email has an account, a reset link is on its way.' });
  };
}

function resetHandler(kind: ResetKind) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = resetSchema.parse(req.body);

    const result = await performPasswordReset(kind, body.token, body.password);

    res.json({ message: 'Password updated. You can sign in now.', shopSlug: result.shopSlug });
  };
}

export const ownerForgotPassword = forgotHandler('owner');
export const ownerResetPassword = resetHandler('owner');
export const barberForgotPassword = forgotHandler('barber');
export const barberResetPassword = resetHandler('barber');
