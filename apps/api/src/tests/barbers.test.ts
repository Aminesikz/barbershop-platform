import { describe, it, beforeEach, mock } from 'node:test';
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

// Mutable state for EXISTING_BARBER (membership flag + person-level profile),
// driven by the updateBarber transaction. Reset per test.
const barberState = {
  is_active: true,
  role_title: null as string | null,
  specialty: null as string | null,
  bio: null as string | null,
};

beforeEach(() => {
  barberState.is_active = true;
  barberState.role_title = null;
  barberState.specialty = null;
  barberState.bio = null;
});

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
        // listBarbersForOwner (incl. inactive, with email)
        if (sql.includes('b.email') && sql.includes('ORDER BY bs.is_active')) {
          return {
            rows: [
              {
                id: EXISTING_BARBER,
                email: 'barber@test.dz',
                name_ar: 'سمير',
                name_en: 'Samir',
                role_title: barberState.role_title,
                specialty: barberState.specialty,
                bio: barberState.bio,
                is_active: barberState.is_active,
                created_at: new Date(),
              },
            ],
          };
        }
        // listActiveBarbers (public — names + profile, no PII)
        if (sql.includes('JOIN barber_shops')) {
          return {
            rows: [
              {
                id: EXISTING_BARBER,
                name_ar: 'سمير',
                name_en: 'Samir',
                role_title: barberState.role_title,
                specialty: barberState.specialty,
                bio: barberState.bio,
              },
            ],
          };
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
            // params = [email, hash, nameAr, nameEn, role, specialty, bio]
            return {
              rows: [
                {
                  id: 'new-barber-1',
                  email: params[0],
                  name_ar: params[2],
                  name_en: params[3],
                  role_title: params[4],
                  specialty: params[5],
                  bio: params[6],
                  created_at: new Date(),
                },
              ],
            };
          }
          // updateBarber: membership lock — 404 gate for barbers not in this shop.
          if (sql.includes('SELECT 1 FROM barber_shops')) {
            const found = params[0] === EXISTING_BARBER && params[1] === SHOP_ID;
            return { rows: found ? [{ '?column?': 1 }] : [], rowCount: found ? 1 : 0 };
          }
          if (sql.includes('UPDATE barber_shops SET is_active')) {
            barberState.is_active = params[0] as boolean;
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes('UPDATE barbers SET')) {
            // Positional params mirror the built SET list; recover by column name.
            const setCols = [...sql.matchAll(/(role_title|specialty|bio) = \$/g)].map((m) => m[1]);
            setCols.forEach((col, i) => {
              barberState[col as 'role_title' | 'specialty' | 'bio'] = params[i] as string | null;
            });
            return { rows: [], rowCount: 1 };
          }
          // updateBarber: re-select the joined admin row.
          if (sql.includes('WHERE b.id')) {
            return {
              rows: [
                {
                  id: EXISTING_BARBER,
                  email: 'barber@test.dz',
                  name_ar: 'سمير',
                  name_en: 'Samir',
                  role_title: barberState.role_title,
                  specialty: barberState.specialty,
                  bio: barberState.bio,
                  is_active: barberState.is_active,
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

  it('POST with profile fields stores and echoes them', async () => {
    const agent = await ownerAgent();
    const res = await agent.post('/api/barbers').set(SLUG).send({
      email: 'pro@test.dz',
      nameAr: 'علي',
      password: 'BarberPass123!',
      role: 'Master Barber',
      specialty: 'Fades & modern styling',
      bio: 'Ten years behind the chair.',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.barber.role, 'Master Barber');
    assert.equal(res.body.barber.specialty, 'Fades & modern styling');
    assert.equal(res.body.barber.bio, 'Ten years behind the chair.');
  });

  it('POST without profile fields stores nulls', async () => {
    const agent = await ownerAgent();
    const res = await agent
      .post('/api/barbers')
      .set(SLUG)
      .send({ email: 'plain@test.dz', nameAr: 'علي', password: 'BarberPass123!' });
    assert.equal(res.status, 201);
    assert.equal(res.body.barber.role, null);
    assert.equal(res.body.barber.specialty, null);
    assert.equal(res.body.barber.bio, null);
  });

  it('PATCH profile fields updates them without touching membership', async () => {
    const agent = await ownerAgent();
    const res = await agent
      .patch(`/api/barbers/${EXISTING_BARBER}`)
      .set(SLUG)
      .send({ role: 'Beard Expert', bio: 'Beard sculpting specialist.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.barber.role, 'Beard Expert');
    assert.equal(res.body.barber.bio, 'Beard sculpting specialist.');
    assert.equal(res.body.barber.specialty, null); // omitted → unchanged
    assert.equal(res.body.barber.isActive, true); // membership untouched
  });

  it('PATCH {isActive} alone leaves the profile unchanged', async () => {
    barberState.role_title = 'Master Barber';
    const agent = await ownerAgent();
    const res = await agent.patch(`/api/barbers/${EXISTING_BARBER}`).set(SLUG).send({ isActive: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.barber.isActive, false);
    assert.equal(res.body.barber.role, 'Master Barber'); // not wiped by the toggle
  });

  it('PATCH with an empty string clears a profile field', async () => {
    barberState.bio = 'Old bio';
    const agent = await ownerAgent();
    const res = await agent.patch(`/api/barbers/${EXISTING_BARBER}`).set(SLUG).send({ bio: '' });
    assert.equal(res.status, 200);
    assert.equal(res.body.barber.bio, null);
  });

  it('PATCH validation: empty body 400, over-long bio 400, unknown field 400', async () => {
    const agent = await ownerAgent();
    const empty = await agent.patch(`/api/barbers/${EXISTING_BARBER}`).set(SLUG).send({});
    assert.equal(empty.status, 400);

    const long = await agent
      .patch(`/api/barbers/${EXISTING_BARBER}`)
      .set(SLUG)
      .send({ bio: 'x'.repeat(401) });
    assert.equal(long.status, 400);

    const unknown = await agent
      .patch(`/api/barbers/${EXISTING_BARBER}`)
      .set(SLUG)
      .send({ email: 'evil@test.dz' }); // email is NOT editable here
    assert.equal(unknown.status, 400);
  });

  it('public GET /api/barbers exposes the profile (still no email)', async () => {
    barberState.role_title = 'Master Barber';
    barberState.specialty = 'Classic cuts';
    barberState.bio = 'Precision and patience.';
    const res = await request(app).get('/api/barbers').set(SLUG);
    assert.equal(res.status, 200);
    assert.equal(res.body.barbers[0].role, 'Master Barber');
    assert.equal(res.body.barbers[0].specialty, 'Classic cuts');
    assert.equal(res.body.barbers[0].bio, 'Precision and patience.');
    assert.equal(res.body.barbers[0].email, undefined);
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
