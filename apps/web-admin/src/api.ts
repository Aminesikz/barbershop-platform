// Admin API client. Talks only to the global /admin + /auth/admin endpoints — no
// X-Shop-Slug (admin is not tenant-scoped), no barber bearer token. Session cookie only.

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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

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
