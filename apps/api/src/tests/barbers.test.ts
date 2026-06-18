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
const ownerHash = await bcrypt.hash('owner-pass', 12);
const barberHash = await bcrypt.hash('barber-pass', 12);
const SHOP_ID = '00000000-0000-0000-0000-0000000000a1';
const EXISTING_BARBER = '11111111-1111-1111-1111-111111111111';
const MISSING_BARBER = '22222222-2222-2222-2222-222222222222';
// In-memory session store so a login persists into the next request (agent keeps the cookie).
const sessions = new Map<string, SessionData>();

// ---- Module mocks ----
mock.module('../config/db.js', {
  namedExports: {
    pool: {
      query: async (sql: string, params: unknown[]) => {
        // tenantResolver: slug → shop
        if (sql.includes('FROM shops WHERE slug')) {
          return params[0] === 'algiers-cuts'
            ? { rows: [{ id: SHOP_ID, slug: 'algiers-cuts', timezone: 'Africa/Algiers', is_active: true }] }
            : { rows: [] };
        }
        // owner login
        if (sql.includes('FROM shop_owners WHERE email')) {
          return params[0] === 'owner@test.dz'
            ? { rows: [{ id: 'owner-1', shop_id: SHOP_ID, password_hash: ownerHash, name: 'Owner' }] }
            : { rows: [] };
        }
        // barber login (verifyBarberCredentials selects bs.is_active AS shop_active)
        if (sql.includes('shop_active')) {
          return params[0] === 'barber@test.dz'
            ? {
                rows: [
                  { id: EXISTING_BARBER, password_hash: barberHash, name_ar: 'سمير', name_en: 'Samir', shop_active: true },
                ],
              }
            : { rows: [] };
        }
        // setBarberActive (deactivate / reactivate)
        if (sql.includes('WITH upd')) {
          // params = [isActive, shopId, barberId]
          return params[2] === EXISTING_BARBER
            ? {
                rows: [
                  {
                    id: EXISTING_BARBER,
                    email: 'barber@test.dz',
                    name_ar: 'سمير',
                    name_en: 'Samir',
                    is_active: params[0],
                    created_at: new Date(),
                  },
                ],
              }
            : { rows: [] };
        }
        // listBarbersForOwner (incl. inactive, with email)
        if (sql.includes('b.email') && sql.includes('ORDER BY bs.is_active')) {
          return {
            rows: [
              {
                id: EXISTING_BARBER,
                email: 'barber@test.dz',
                name_ar: 'سمير',
                name_en: 'Samir',
                is_active: true,
                created_at: new Date(),
              },
            ],
          };
        }
        // listActiveBarbers (public — names only)
        if (sql.includes('JOIN barber_shops')) {
          return { rows: [{ id: EXISTING_BARBER, name_ar: 'سمير', name_en: 'Samir' }] };
        }
        return { rows: [], rowCount: 0 };
      },
      on: () => {},
    },
    testConnection: async () => {},
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes('INSERT INTO barbers')) {
            if (params[0] === 'dup@test.dz') {
              throw Object.assign(new Error('dup'), { code: '23505', constraint: 'barbers_email_key' });
            }
            return {
              rows: [
                {
                  id: 'new-barber-1',
                  email: params[0],
                  name_ar: params[2],
                  name_en: params[3],
                  created_at: new Date(),
                },
              ],
            };
          }
          // INSERT INTO barber_shops
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

// Extends the real express-session Store so inherited helpers exist on rehydrate.
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

// tenantResolver reads the subdomain of the Host header (slug.platform.dz). supertest's
// default Host (127.0.0.1:PORT) has ≥3 dot-parts, so we MUST set a real subdomain Host
// for the slug to resolve — X-Shop-Slug is only the fallback when Host has <3 parts.
const SLUG = { Host: 'algiers-cuts.platform.dz' };

async function ownerAgent() {
  const agent = request.agent(app);
  const login = await agent.post('/auth/owner/login').send({ email: 'owner@test.dz', password: 'owner-pass' });
  assert.equal(login.status, 200);
  return agent;
}

// ============================================================
// Public barber list (no auth, names only)
// ============================================================
describe('Public barber list', () => {
  it('GET /api/barbers returns active barbers without PII', async () => {
    const res = await request(app).get('/api/barbers').set(SLUG);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.barbers));
    assert.equal(res.body.barbers[0].email, undefined); // no email leaked
  });
});

// ============================================================
// Owner barber management
// ============================================================
describe('Owner barber management', () => {
  it('GET /api/barbers/all without a session returns 401', async () => {
    const res = await request(app).get('/api/barbers/all').set(SLUG);
    assert.equal(res.status, 401);
  });

  it('GET /api/barbers/all with an owner session returns 200 (incl. email + isActive)', async () => {
    const agent = await ownerAgent();
    const res = await agent.get('/api/barbers/all').set(SLUG);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.barbers));
    assert.equal(res.body.barbers[0].email, 'barber@test.dz');
    assert.equal(res.body.barbers[0].isActive, true);
  });

  it('POST /api/barbers creates a barber → 201', async () => {
    const agent = await ownerAgent();
    const res = await agent
      .post('/api/barbers')
      .set(SLUG)
      .send({ email: 'new@test.dz', nameAr: 'علي', nameEn: 'Ali', password: 'BarberPass123!' });
    assert.equal(res.status, 201);
    assert.equal(res.body.barber.email, 'new@test.dz');
    assert.equal(res.body.barber.nameEn, 'Ali');
    assert.equal(res.body.barber.isActive, true);
  });

  it('POST /api/barbers without a session returns 401', async () => {
    const res = await request(app)
      .post('/api/barbers')
      .set(SLUG)
      .send({ email: 'x@test.dz', nameAr: 'x', password: 'BarberPass123!' });
    assert.equal(res.status, 401);
  });

  it('duplicate email returns 409', async () => {
    const agent = await ownerAgent();
    const res = await agent
      .post('/api/barbers')
      .set(SLUG)
      .send({ email: 'dup@test.dz', nameAr: 'علي', password: 'BarberPass123!' });
    assert.equal(res.status, 409);
  });

  it('invalid email returns 400', async () => {
    const agent = await ownerAgent();
    const res = await agent
      .post('/api/barbers')
      .set(SLUG)
      .send({ email: 'not-an-email', nameAr: 'علي', password: 'BarberPass123!' });
    assert.equal(res.status, 400);
  });

  it('short password returns 400', async () => {
    const agent = await ownerAgent();
    const res = await agent
      .post('/api/barbers')
      .set(SLUG)
      .send({ email: 'p@test.dz', nameAr: 'علي', password: 'short' });
    assert.equal(res.status, 400);
  });

  it('PATCH /api/barbers/:id deactivates → 200 with isActive false', async () => {
    const agent = await ownerAgent();
    const res = await agent.patch(`/api/barbers/${EXISTING_BARBER}`).set(SLUG).send({ isActive: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.barber.isActive, false);
  });

  it('PATCH an unknown barber returns 404', async () => {
    const agent = await ownerAgent();
    const res = await agent.patch(`/api/barbers/${MISSING_BARBER}`).set(SLUG).send({ isActive: false });
    assert.equal(res.status, 404);
  });

  it('SECURITY: a barber JWT does NOT satisfy requireOwner', async () => {
    const login = await request(app)
      .post('/auth/barber/login')
      .send({ email: 'barber@test.dz', password: 'barber-pass', shopId: SHOP_ID });
    assert.equal(login.status, 200);
    const token = login.body.token as string;

    const res = await request(app).get('/api/barbers/all').set(SLUG).set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401); // owner-only — a valid barber token is not enough
  });
});
