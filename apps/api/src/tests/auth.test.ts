import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// ---- Env stub (must run before any module that imports env) ----
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3000';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['SESSION_SECRET'] = 'test-session-secret-minimum-32-chars!!';
process.env['SESSION_MAX_AGE_MS'] = '86400000';
process.env['JWT_SECRET'] = 'test-jwt-secret-minimum-32-chars!!!!!';
process.env['JWT_EXPIRES_IN'] = '1h';
process.env['ALLOWED_ORIGIN_PATTERN'] = '*.platform.dz';
process.env['PHONE_HMAC_SECRET'] = 'test-phone-hmac-secret-minimum-32-chars!!';

// ---- Fixtures ----
const ownerPasswordHash = await bcrypt.hash('correct-password', 12);
const barberPasswordHash = await bcrypt.hash('barber-password', 12);

const DB_RECORDS = {
  owners: new Map([
    ['owner@shop.dz', { id: 'owner-uuid', shop_id: '11111111-1111-1111-1111-111111111111', password_hash: ownerPasswordHash, name: 'Test Owner' }],
  ]),
  barbers: new Map([
    ['barber@shop.dz:11111111-1111-1111-1111-111111111111', { id: 'barber-uuid', password_hash: barberPasswordHash, name_ar: 'باربر', name_en: 'Test Barber', shop_active: true }],
  ]),
  shops: new Map([
    ['active-shop', { id: '11111111-1111-1111-1111-111111111111', slug: 'active-shop', timezone: 'Africa/Algiers', is_active: true }],
    ['inactive-shop', { id: 'other-uuid', slug: 'inactive-shop', timezone: 'Africa/Algiers', is_active: false }],
  ]),
};

// ---- Module mocks ----
mock.module('../config/db.js', {
  namedExports: {
    pool: {
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('shop_owners')) {
          const email = params[0] as string;
          const row = DB_RECORDS.owners.get(email);
          return { rows: row ? [row] : [] };
        }
        if (sql.includes('barbers')) {
          const email = params[0] as string;
          const shopId = params[1] as string;
          const row = DB_RECORDS.barbers.get(`${email}:${shopId}`);
          return { rows: row ? [row] : [] };
        }
        if (sql.includes('shops')) {
          const slug = params[0] as string;
          const row = DB_RECORDS.shops.get(slug);
          return { rows: row ? [row] : [] };
        }
        return { rows: [] };
      },
      on: () => {},
    },
    testConnection: async () => {},
    // Booking modules import this; auth tests never invoke it, so a passthrough stub suffices.
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
    // express-session expects the store to be an EventEmitter (it calls store.on('disconnect'/'connect')).
    on(_event: string, _cb: (...args: unknown[]) => void): void {}
    get(_sid: string, cb: (err: unknown, session: unknown) => void): void { cb(null, null); }
    set(_sid: string, _session: unknown, cb: (err: unknown) => void): void { cb(null); }
    destroy(_sid: string, cb: (err: unknown) => void): void { cb(null); }
    touch(_sid: string, _session: unknown, cb: (err: unknown) => void): void { cb(null); }
  },
});

mock.module('rate-limit-redis', {
  namedExports: {
    // Must implement express-rate-limit's Store interface (increment/decrement/resetKey),
    // not just sendCommand — otherwise rateLimit() rejects it as an invalid store.
    // increment always reports a single hit so the limiter never trips during tests.
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

// ============================================================
// Owner auth
// ============================================================
describe('Owner auth', () => {
  it('login success sets session and returns name + shopId', async () => {
    const res = await request(app)
      .post('/auth/owner/login')
      .send({ email: 'owner@shop.dz', password: 'correct-password' });

    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Test Owner');
    assert.equal(res.body.shopId, '11111111-1111-1111-1111-111111111111');
  });

  it('login wrong password returns 401', async () => {
    const res = await request(app)
      .post('/auth/owner/login')
      .send({ email: 'owner@shop.dz', password: 'wrong-password' });

    assert.equal(res.status, 401);
    assert.ok(res.body.error);
    // SECURITY: must not leak whether the email exists
    assert.doesNotMatch(String(res.body.error), /not found/i);
  });

  it('login unknown email returns 401 with same generic message', async () => {
    const res = await request(app)
      .post('/auth/owner/login')
      .send({ email: 'nobody@shop.dz', password: 'any' });

    assert.equal(res.status, 401);
    assert.ok(res.body.error);
  });

  it('login missing password returns 400', async () => {
    const res = await request(app)
      .post('/auth/owner/login')
      .send({ email: 'owner@shop.dz' });

    assert.equal(res.status, 400);
  });

  it('login invalid email format returns 400', async () => {
    const res = await request(app)
      .post('/auth/owner/login')
      .send({ email: 'not-an-email', password: 'x' });

    assert.equal(res.status, 400);
  });

  it('GET /owner/me without session returns 401', async () => {
    const res = await request(app).get('/auth/owner/me');
    assert.equal(res.status, 401);
  });
});

// ============================================================
// Barber auth
// ============================================================
describe('Barber auth', () => {
  it('login success returns JWT and barber info', async () => {
    const res = await request(app)
      .post('/auth/barber/login')
      .send({ email: 'barber@shop.dz', password: 'barber-password', shopId: '11111111-1111-1111-1111-111111111111' });

    assert.equal(res.status, 200);
    assert.ok(typeof res.body.token === 'string');
    assert.equal(res.body.barber.shopId, '11111111-1111-1111-1111-111111111111');
    assert.equal(res.body.barber.name, 'Test Barber');
  });

  it('login wrong password returns 401', async () => {
    const res = await request(app)
      .post('/auth/barber/login')
      .send({ email: 'barber@shop.dz', password: 'wrong', shopId: '11111111-1111-1111-1111-111111111111' });

    assert.equal(res.status, 401);
  });

  it('login barber not in given shop returns 401', async () => {
    const res = await request(app)
      .post('/auth/barber/login')
      .send({ email: 'barber@shop.dz', password: 'barber-password', shopId: '00000000-0000-0000-0000-000000000000' });

    assert.equal(res.status, 401);
  });

  it('login missing shopId returns 400', async () => {
    const res = await request(app)
      .post('/auth/barber/login')
      .send({ email: 'barber@shop.dz', password: 'barber-password' });

    assert.equal(res.status, 400);
  });
});

// ============================================================
// JWT middleware (via GET /auth/barber/me)
// ============================================================
describe('JWT middleware', () => {
  let validToken: string;

  before(async () => {
    const res = await request(app)
      .post('/auth/barber/login')
      .send({ email: 'barber@shop.dz', password: 'barber-password', shopId: '11111111-1111-1111-1111-111111111111' });
    validToken = res.body.token as string;
  });

  it('valid token returns barber info', async () => {
    const res = await request(app)
      .get('/auth/barber/me')
      .set('Authorization', `Bearer ${validToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.shopId, '11111111-1111-1111-1111-111111111111');
  });

  it('missing Authorization header returns 401', async () => {
    const res = await request(app).get('/auth/barber/me');
    assert.equal(res.status, 401);
  });

  it('Authorization without Bearer scheme returns 401', async () => {
    const res = await request(app)
      .get('/auth/barber/me')
      .set('Authorization', `Token ${validToken}`);
    assert.equal(res.status, 401);
  });

  it('expired token returns 401', async () => {
    const expired = jwt.sign(
      { sub: 'barber-uuid', shopId: '11111111-1111-1111-1111-111111111111', name: 'Test' },
      process.env['JWT_SECRET']!,
      { expiresIn: -1 },
    );
    const res = await request(app)
      .get('/auth/barber/me')
      .set('Authorization', `Bearer ${expired}`);

    assert.equal(res.status, 401);
  });

  it('tampered signature returns 401', async () => {
    const [header, payload] = validToken.split('.');
    const tampered = `${header}.${payload}.invalidsignature`;
    const res = await request(app)
      .get('/auth/barber/me')
      .set('Authorization', `Bearer ${tampered}`);

    assert.equal(res.status, 401);
  });

  it('token signed with wrong secret returns 401', async () => {
    const forged = jwt.sign(
      { sub: 'barber-uuid', shopId: '11111111-1111-1111-1111-111111111111', name: 'Hacker' },
      'totally-wrong-secret-pad-to-32-chars!!',
    );
    const res = await request(app)
      .get('/auth/barber/me')
      .set('Authorization', `Bearer ${forged}`);

    assert.equal(res.status, 401);
  });
});

// ============================================================
// Tenant resolver middleware
// ============================================================
describe('Tenant resolver', () => {
  it('valid slug via X-Shop-Slug sets req.shop', async () => {
    const { tenantResolver } = await import('../shared/middleware/tenantResolver.js');
    let capturedShop: unknown;

    const mockReq = { get: (h: string) => h === 'X-Shop-Slug' ? 'active-shop' : undefined } as never;
    const mockRes = { status: () => mockRes, json: () => {} } as never;
    const mockNext = () => { capturedShop = (mockReq as { shop?: unknown }).shop; };

    await tenantResolver(mockReq, mockRes, mockNext);
    assert.deepEqual(capturedShop, { id: '11111111-1111-1111-1111-111111111111', slug: 'active-shop', timezone: 'Africa/Algiers' });
  });

  it('unknown slug returns 404', async () => {
    const { tenantResolver } = await import('../shared/middleware/tenantResolver.js');
    let statusCode = 0;
    let responseBody: unknown;

    const mockReq = { get: (h: string) => h === 'X-Shop-Slug' ? 'no-such-shop' : undefined } as never;
    const mockRes = {
      status: (code: number) => { statusCode = code; return mockRes; },
      json: (b: unknown) => { responseBody = b; },
    } as never;

    await tenantResolver(mockReq, mockRes, () => {});
    assert.equal(statusCode, 404);
    assert.deepEqual(responseBody, { error: 'Shop not found' });
  });

  it('inactive shop returns 404', async () => {
    const { tenantResolver } = await import('../shared/middleware/tenantResolver.js');
    let statusCode = 0;

    const mockReq = { get: (h: string) => h === 'X-Shop-Slug' ? 'inactive-shop' : undefined } as never;
    const mockRes = {
      status: (code: number) => { statusCode = code; return mockRes; },
      json: () => {},
    } as never;

    await tenantResolver(mockReq, mockRes, () => {});
    assert.equal(statusCode, 404);
  });

  it('missing slug returns 400', async () => {
    const { tenantResolver } = await import('../shared/middleware/tenantResolver.js');
    let statusCode = 0;

    const mockReq = { get: () => undefined } as never;
    const mockRes = {
      status: (code: number) => { statusCode = code; return mockRes; },
      json: () => {},
    } as never;

    await tenantResolver(mockReq, mockRes, () => {});
    assert.equal(statusCode, 400);
  });
});
