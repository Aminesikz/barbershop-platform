import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcrypt';
import session, { type SessionData } from 'express-session';

// ---- Env stub (before any module that imports config/env) ----
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3000';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['SESSION_SECRET'] = 'test-session-secret-minimum-32-chars!!';
process.env['JWT_SECRET'] = 'test-jwt-secret-minimum-32-chars!!!!!';
process.env['ALLOWED_ORIGIN_PATTERN'] = '*.platform.dz';
process.env['PHONE_HMAC_SECRET'] = 'test-phone-hmac-secret-minimum-32-chars!!';

// ---- Fixtures ----
const adminHash = await bcrypt.hash('admin-pass', 12);
const ownerHash = await bcrypt.hash('owner-pass', 12);
// In-memory session store so a login persists into the next request (agent keeps the cookie).
const sessions = new Map<string, SessionData>();

// ---- Module mocks ----
mock.module('../config/db.js', {
  namedExports: {
    pool: {
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('platform_admins')) {
          return params[0] === 'admin@test.dz'
            ? { rows: [{ id: 'admin-1', password_hash: adminHash, name: 'Test Admin' }] }
            : { rows: [] };
        }
        if (sql.includes('FROM shops s')) {
          return {
            rows: [
              {
                id: 'shop-1',
                slug: 'algiers-cuts',
                timezone: 'Africa/Algiers',
                is_active: true,
                created_at: new Date(),
                owner_email: 'owner@test.dz',
              },
            ],
          };
        }
        if (sql.includes('FROM shop_owners WHERE email')) {
          return params[0] === 'owner@test.dz'
            ? { rows: [{ id: 'owner-1', shop_id: 'shop-1', password_hash: ownerHash, name: 'Owner' }] }
            : { rows: [] };
        }
        return { rows: [], rowCount: 0 };
      },
      on: () => {},
    },
    testConnection: async () => {},
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes('INSERT INTO shops')) {
            if (params[0] === 'dup-shop') {
              const e = Object.assign(new Error('dup'), { code: '23505', constraint: 'shops_slug_key' });
              throw e;
            }
            return {
              rows: [
                { id: 'new-1', slug: params[0], timezone: params[1], is_active: true, created_at: new Date() },
              ],
            };
          }
          return { rows: [], rowCount: 1 };
        },
      }),
  },
});

mock.module('../config/redis.js', {
  namedExports: {
    redis: {
      call: async () => 'OK',
      on: () => {},
      incr: async () => 1,
      expire: async () => 1,
      get: async () => null,
      set: async () => 'OK',
      del: async () => 1,
    },
  },
});

// Extends the real express-session Store so inherited helpers (createSession, etc.)
// exist when a persisted session is rehydrated across requests.
mock.module('connect-redis', {
  defaultExport: class extends session.Store {
    get(sid: string, cb: (err: unknown, s?: SessionData | null) => void): void {
      cb(null, sessions.get(sid) ?? null);
    }
    set(sid: string, s: SessionData, cb?: (err?: unknown) => void): void {
      sessions.set(sid, s);
      cb?.();
    }
    destroy(sid: string, cb?: (err?: unknown) => void): void {
      sessions.delete(sid);
      cb?.();
    }
    touch(_sid: string, _s: SessionData, cb?: () => void): void {
      cb?.();
    }
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
    createClient: () => ({ connect: async () => {}, on: () => {} }),
  },
});

const { app } = await import('../app.js');

// ============================================================
// Platform-admin auth
// ============================================================
describe('Platform admin auth', () => {
  it('login success returns name + sets session', async () => {
    const res = await request(app)
      .post('/auth/admin/login')
      .send({ email: 'admin@test.dz', password: 'admin-pass' });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Test Admin');
  });

  it('wrong password returns 401', async () => {
    const res = await request(app)
      .post('/auth/admin/login')
      .send({ email: 'admin@test.dz', password: 'nope' });
    assert.equal(res.status, 401);
  });

  it('unknown email returns 401 (no oracle)', async () => {
    const res = await request(app)
      .post('/auth/admin/login')
      .send({ email: 'ghost@test.dz', password: 'whatever' });
    assert.equal(res.status, 401);
    assert.doesNotMatch(String(res.body.error), /not found/i);
  });
});

// ============================================================
// Platform-admin API + isolation
// ============================================================
describe('Platform admin API', () => {
  it('GET /admin/shops without session returns 401', async () => {
    const res = await request(app).get('/admin/shops');
    assert.equal(res.status, 401);
  });

  it('GET /admin/shops with admin session returns 200', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/admin/login').send({ email: 'admin@test.dz', password: 'admin-pass' });
    const res = await agent.get('/admin/shops');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.shops));
  });

  it('SECURITY: an owner session does NOT satisfy requirePlatformAdmin', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/auth/owner/login').send({ email: 'owner@test.dz', password: 'owner-pass' });
    assert.equal(login.status, 200); // owner login itself works
    const res = await agent.get('/admin/shops');
    assert.equal(res.status, 401); // but cannot reach the admin API
  });

  it('create shop + owner returns 201', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/admin/login').send({ email: 'admin@test.dz', password: 'admin-pass' });
    const res = await agent
      .post('/admin/shops')
      .send({ slug: 'oran-fades', ownerEmail: 'o@oran.dz', ownerName: 'Sami', ownerPassword: 'OranPass123!' });
    assert.equal(res.status, 201);
    assert.equal(res.body.shop.slug, 'oran-fades');
    assert.equal(res.body.shop.ownerEmail, 'o@oran.dz');
  });

  it('duplicate slug returns 409', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/admin/login').send({ email: 'admin@test.dz', password: 'admin-pass' });
    const res = await agent
      .post('/admin/shops')
      .send({ slug: 'dup-shop', ownerEmail: 'o@dup.dz', ownerName: 'Zed', ownerPassword: 'ZedPass123!' });
    assert.equal(res.status, 409);
  });

  it('invalid slug returns 400', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/admin/login').send({ email: 'admin@test.dz', password: 'admin-pass' });
    const res = await agent
      .post('/admin/shops')
      .send({ slug: 'Bad Slug!', ownerEmail: 'o@x.dz', ownerName: 'Zed', ownerPassword: 'ZedPass123!' });
    assert.equal(res.status, 400);
  });
});
