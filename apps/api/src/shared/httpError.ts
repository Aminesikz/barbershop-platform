/**
 * Application error carrying an HTTP status. The central errorHandler reads
 * `statusCode` to set the response status; anything without one becomes a 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    // 4xx messages are safe to send to the client; 5xx are not.
    this.expose = statusCode < 500;
  }
}

export const badRequest = (msg = 'Bad request'): AppError => new AppError(400, msg);
export const unauthorized = (msg = 'Unauthorized'): AppError => new AppError(401, msg);
export const forbidden = (msg = 'Forbidden'): AppError => new AppError(403, msg);
export const notFound = (msg = 'Not found'): AppError => new AppError(404, msg);
export const conflict = (msg = 'Conflict'): AppError => new AppError(409, msg);
export const tooManyRequests = (msg = 'Too many requests'): AppError => new AppError(429, msg);
