import { env } from '../config/env.js';

/**
 * Compile ALLOWED_ORIGIN_PATTERN (e.g. `https://*.platform.dz`) into an anchored
 * regex. `*.<domain>` matches the subdomains AND the bare apex — the password-reset
 * page is served from the apex, so its requests must pass. The subdomain group
 * stays anchored (`([a-z0-9-]+\.)?`) so lookalike domains can't match.
 *
 * Shared by the HTTP CORS check (app.ts) and the WebSocket upgrade (ws.auth.ts) so
 * the two surfaces can never drift apart.
 */
export function compileOriginPattern(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\\\./g, '([a-z0-9-]+\\.)?')
    .replace(/\*/g, '[a-z0-9-]+');
  return new RegExp(`^${escaped}$`);
}

export const allowedOriginPattern = compileOriginPattern(env.ALLOWED_ORIGIN_PATTERN);
