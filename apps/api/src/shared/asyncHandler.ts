import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wrap an async Express handler/middleware so a rejected promise is forwarded to
 * next(err). Express 4 does NOT catch async rejections on its own, so without this
 * an unhandled rejection in a handler would hang the request instead of hitting the
 * central errorHandler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
