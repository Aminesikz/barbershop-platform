import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// ---- Env stub (must run before any module that imports env) ----
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3000';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['SESSION_SECRET'] = 'test-session-secret-minimum-32-chars!!';
process.env['SESSION_MAX_AGE_MS'] = '86400000';
process.env['JWT_SECRET'] = 'test-jwt-secret-minimum-32-chars!!!!!';
process.env['JWT_EXPIRES_IN'] = '1h';
process.env['ALLOWED_ORIGIN_PATTERN'] = 'https://*.platform.dz';
process.env['PHONE_HMAC_SECRET'] = 'test-phone-hmac-secret-minimum-32-chars!!';

// ---- Module mocks (app boot only; no test in this file touches DB/redis) ----
mock.module('../config/db.js', {
  namedExports: {
    pool: { query: async () => ({ rows: [], rowCount: 0 }), on: () => {} },
    testConnection: async () => {},
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
  },
});

mock.module('../config/redis.js', {
  namedExports: {
    redis: {
      call: async () => 'OK',
      on: () => {},
      get: async () => null,
      set: async () => 'OK',
      del: async () => 1,
    },
  },
});

mock.module('connect-redis', {
  defaultExport: class {
    on(_event: string, _cb: (...args: unknown[]) => void): void {}
    get(_sid: string, cb: (err: unknown, session: unknown) => void): void { cb(null, null); }
    set(_sid: string, _session: unknown, cb: (err: unknown) => void): void { cb(null); }
    destroy(_sid: string, cb: (err: unknown) => void): void { cb(null); }
    touch(_sid: string, _session: unknown, cb: (err: unknown) => void): void { cb(null); }
  },
});

mock.module('rate-limit-redis', {
  namedExports: {
    RedisStore: class {
      init(): void {}
      async increment(): Promise<{ totalHits: number; resetTime: Date }> {
        return { totalHits: 1, resetTime: new Date(Date.now() + 60_000) };
      }
      async decrement(): Promise<void> {}
      async resetKey(): Promise<void> {}
      async resetAll(): Promise<void> {}
    },
  },
});

mock.module('redis', {
  namedExports: {
    createClient: () => ({
      connect: async () => {},
      on: () => {},
    }),
  },
});

// Import app AFTER mocks are wired
const { app } = await import('../app.js');

function preflight(origin: string) {
  return request(app)
    .options('/auth/owner/login')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type');
}

// The wildcard pattern `https://*.platform.dz` must admit the shop subdomains AND
// the bare apex (the password-reset page is served from the apex), while lookalike
// domains stay rejected.
describe('CORS origin pattern', () => {
  it('allows a shop subdomain origin', async () => {
    const res = await preflight('https://algiers-cuts.platform.dz');
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://algiers-cuts.platform.dz');
  });

  it('allows the bare apex origin (reset page lives there)', async () => {
    const res = await preflight('https://platform.dz');
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://platform.dz');
  });

  it('rejects a lookalike domain ending in the platform name', async () => {
    const res = await preflight('https://evil-platform.dz');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('rejects an unescaped-dot lookalike', async () => {
    const res = await preflight('https://platformxdz');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('rejects nested subdomains and http downgrade', async () => {
    for (const origin of ['https://a.b.platform.dz', 'http://platform.dz']) {
      const res = await preflight(origin);
      assert.equal(res.headers['access-control-allow-origin'], undefined, origin);
    }
  });
});
