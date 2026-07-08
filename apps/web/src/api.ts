// Thin fetch wrapper. The Vite dev proxy forwards /api and /auth to the Express API,
// so this is same-origin: the owner session cookie works and there's no CORS.

const TOKEN_KEY = 'barber.token';

// Subdomains that are NOT a shop slug.
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api', 'localhost']);

// API origin. Local dev: '' → same-origin (Vite proxies /api,/auth to :3000).
// Production (split deploy): https://api.platform.dz. Used for HTTP and WebSocket URLs.
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '');

/**
 * The shop this page is for, resolved at RUNTIME so ONE build serves every shop:
 *   1. ?shop=<slug>            — query param (local/dev multi-shop testing)
 *   2. hostname subdomain      — slug.platform.dz (skipping reserved labels) — prod
 *   3. VITE_SHOP_SLUG          — build-time pin (local single-shop dev)
 *   4. null                    — caller renders the "shop not found" state
 */
function resolveShopSlug(): string | null {
  const q = new URLSearchParams(window.location.search).get('shop')?.trim();
  if (q) return q;

  const parts = window.location.hostname.split('.');
  if (parts.length >= 3) {
    const sub = parts[0];
    if (sub && !RESERVED_SUBDOMAINS.has(sub)) return sub;
  }

  const pin = (import.meta.env.VITE_SHOP_SLUG ?? '').trim();
  return pin || null;
}

const SHOP_SLUG = resolveShopSlug();

/** The active shop slug, or null when this page maps to no shop. */
export function getShopSlug(): string | null {
  return SHOP_SLUG;
}

/** Build a WebSocket URL to the API (wss in prod via API_BASE, ws://host:3000 locally). */
export function wsUrl(query: string): string {
  if (API_BASE) return `${API_BASE.replace(/^http/, 'ws')}/?${query}`;
  return `ws://${window.location.hostname}:3000/?${query}`;
}

export function getBarberToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setBarberToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Notified whenever any API call answers 401. The auth layer registers here so a
 * session that dies underneath an open console (logout in another tab — the sid
 * cookie is shared across every *.dzbarbers.com subdomain — or plain expiry)
 * drops the app back to the login screen instead of leaving a half-logged-in UI
 * that errors on every click.
 */
let unauthorizedListener: (() => void) | null = null;
export function onUnauthorized(listener: (() => void) | null): void {
  unauthorizedListener = listener;
}

/**
 * Shown for every guard-level 401 ("Unauthorized" from requireStaff/requireOwner —
 * login failures say "Invalid credentials" and keep their own wording). The auth
 * layer toasts the SAME string, so concurrent failures dedupe into one toast.
 */
export const SIGNED_OUT_MESSAGE = 'You were signed out — please sign in again.';

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
  // /api routes are tenant-scoped; the header carries the shop derived from the
  // hostname (authoritative on the API). /auth routes are not tenant-scoped.
  if (path.startsWith('/api') && SHOP_SLUG) headers['X-Shop-Slug'] = SHOP_SLUG;
  const token = getBarberToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  });

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // The listener decides whether this 401 means "session lost" (it no-ops when
    // nobody is signed in, so login failures and logged-out /me probes are unaffected).
    if (res.status === 401) unauthorizedListener?.();
    const errObj = (data ?? {}) as { error?: unknown; details?: unknown };
    let msg = typeof errObj.error === 'string' ? errObj.error : `Request failed (${res.status})`;
    if (res.status === 401 && msg === 'Unauthorized') msg = SIGNED_OUT_MESSAGE;
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
