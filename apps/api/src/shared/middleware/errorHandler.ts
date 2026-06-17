import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export interface AppError extends Error {
  statusCode?: number;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.flatten().fieldErrors });
    return;
  }

  const statusCode = err.statusCode ?? 500;
  const message = statusCode < 500 ? err.message : 'Internal server error';

  if (statusCode >= 500) {
    console.error('Unhandled error:', err);
  }

  res.status(statusCode).json({ error: message });
}
