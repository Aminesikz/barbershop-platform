// Thin fetch wrapper. The Vite dev proxy forwards /api and /auth to the Express API,
// so this is same-origin: the owner session cookie works and there's no CORS.

const SHOP_KEY = 'barber.shopSlug';
const TOKEN_KEY = 'barber.token';

export function getShopSlug(): string {
  return localStorage.getItem(SHOP_KEY) ?? 'algiers-cuts';
}
export function setShopSlug(slug: string): void {
  localStorage.setItem(SHOP_KEY, slug);
}

export function getBarberToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setBarberToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  // /api routes are tenant-scoped; /auth routes are not.
  if (path.startsWith('/api')) headers['X-Shop-Slug'] = getShopSlug();
  const token = getBarberToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  });

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const errObj = (data ?? {}) as { error?: unknown; details?: unknown };
    const msg = typeof errObj.error === 'string' ? errObj.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, errObj.details);
  }
  return data as T;
}

/** Human-friendly message from any thrown error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.details && typeof err.details === 'object') {
      const fields = Object.entries(err.details as Record<string, string[]>)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
        .join(' · ');
      if (fields) return `${err.message} — ${fields}`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
