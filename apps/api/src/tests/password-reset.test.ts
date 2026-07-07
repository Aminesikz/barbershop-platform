import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcrypt';

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
process.env['WEB_BASE_URL'] = 'https://dzbarbers.com';

// ---- Fixtures ----
const OWNER = { id: 'owner-uuid', email: 'owner@shop.dz', name: 'Test Owner' };
const BARBER = { id: 'barber-uuid', email: 'barber@shop.dz', name: 'Test Barber' };

interface TokenRow {
  id: string;
  owner_id: string | null;
  barber_id: string | null;
  expires_at: Date;
  used_at: Date | null;
}

// In-memory stand-ins for the password_reset_tokens table and side effects.
const tokens = new Map<string, TokenRow>(); // keyed by token_hash
const passwordUpdates: Array<{ table: string; hash: string; id: string }> = [];
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
let emailConfigured = true;
let tokenSeq = 0;

// ---- Module mocks ----
mock.module('../shared/email.js', {
  namedExports: {
    isEmailConfigured: () => emailConfigured,
    sendEmail: async (input: { to: string; subject: string; text: string }) => {
      sentEmails.push(input);
    },
  },
});

function queryHandler(sql: string, params: unknown[]): { rows: unknown[]; rowCount: number } {
  // Account lookups (requestPasswordReset)
  if (sql.includes('FROM shop_owners WHERE email')) {
    const rows = params[0] === OWNER.email ? [OWNER] : [];
    return { rows, rowCount: rows.length };
  }
  if (sql.includes('FROM barbers WHERE email')) {
    const rows = params[0] === BARBER.email ? [BARBER] : [];
    return { rows, rowCount: rows.length };
  }

  // Token insert (requestPasswordReset)
  if (sql.includes('INSERT INTO password_reset_tokens')) {
    const isOwner = sql.includes('(owner_id');
    const [actorId, tokenHash, ttlMin] = params as [string, string, number];
    tokens.set(tokenHash, {
      id: `tok-${++tokenSeq}`,
      owner_id: isOwner ? actorId : null,
      barber_id: isOwner ? null : actorId,
      expires_at: new Date(Date.now() + ttlMin * 60_000),
      used_at: null,
    });
    return { rows: [], rowCount: 1 };
  }

  // Token lookup FOR UPDATE (performPasswordReset)
  if (sql.includes('FROM password_reset_tokens') && sql.includes('FOR UPDATE')) {
    const isOwner = sql.includes('owner_id AS actor_id');
    const row = tokens.get(params[0] as string);
    const actorId = isOwner ? row?.owner_id : row?.barber_id;
    if (!row || !actorId) return { rows: [], rowCount: 0 };
    return {
      rows: [
        {
          id: row.id,
          actor_id: actorId,
          expired_or_used: row.used_at !== null || row.expires_at <= new Date(),
        },
      ],
      rowCount: 1,
    };
  }

  // Password update
  if (sql.includes('SET password_hash')) {
    const table = sql.includes('shop_owners') ? 'shop_owners' : 'barbers';
    const [hash, id] = params as [string, string];
    const exists = (table === 'shop_owners' ? OWNER.id : BARBER.id) === id;
    if (exists) passwordUpdates.push({ table, hash, id });
    return { rows: [], rowCount: exists ? 1 : 0 };
  }

  // Mark token used
  if (sql.includes('SET used_at')) {
    for (const row of tokens.values()) {
      if (row.id === params[0]) row.used_at = new Date();
    }
    return { rows: [], rowCount: 1 };
  }

  // Void other outstanding tokens
  if (sql.startsWith('DELETE FROM password_reset_tokens')) {
    const isOwner = sql.includes('owner_id');
    for (const [hash, row] of tokens) {
      const actor = isOwner ? row.owner_id : row.barber_id;
      if (actor === params[0] && row.used_at === null && row.id !== params[1]) tokens.delete(hash);
    }
    return { rows: [], rowCount: 0 };
  }

  // Owner shop slug for the success response
  if (sql.includes('SELECT s.slug')) {
    const rows = params[0] === OWNER.id ? [{ slug: 'active-shop' }] : [];
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

mock.module('../config/db.js', {
  namedExports: {
    pool: {
      query: async (sql: string, params: unknown[]) => queryHandler(sql, params),
      on: () => {},
    },
    testConnection: async () => {},
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: async (sql: string, params: unknown[]) => queryHandler(sql, params) }),
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

function lastEmailToken(): string {
  const text = sentEmails[sentEmails.length - 1]?.text ?? '';
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  assert.ok(match, 'reset email should contain a token');
  return match[1] as string;
}

beforeEach(() => {
  tokens.clear();
  passwordUpdates.length = 0;
  sentEmails.length = 0;
  emailConfigured = true;
});

// ============================================================
// Forgot password
// ============================================================
describe('Forgot password', () => {
  it('existing owner: 202 and a reset email with an owner link', async () => {
    const res = await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });

    assert.equal(res.status, 202);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0]?.to, OWNER.email);
    assert.match(sentEmails[0]?.text ?? '', /https:\/\/dzbarbers\.com\/reset-password\?kind=owner&token=/);
  });

  it('unknown email: same 202, but no email is sent (no enumeration)', async () => {
    const res = await request(app).post('/auth/owner/forgot-password').send({ email: 'nobody@shop.dz' });

    assert.equal(res.status, 202);
    assert.equal(sentEmails.length, 0);
  });

  it('malformed email: 400', async () => {
    const res = await request(app).post('/auth/owner/forgot-password').send({ email: 'not-an-email' });
    assert.equal(res.status, 400);
  });

  it('extra body fields rejected (strict schema)', async () => {
    const res = await request(app)
      .post('/auth/owner/forgot-password')
      .send({ email: OWNER.email, admin: true });
    assert.equal(res.status, 400);
  });

  it('email not configured: 503 with an explanatory message', async () => {
    emailConfigured = false;
    const res = await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });

    assert.equal(res.status, 503);
    assert.match(String(res.body.error), /unavailable/i);
  });

  it('barber: 202 and the link carries kind=barber', async () => {
    const res = await request(app).post('/auth/barber/forgot-password').send({ email: BARBER.email });

    assert.equal(res.status, 202);
    assert.match(sentEmails[0]?.text ?? '', /kind=barber&token=/);
  });
});

// ============================================================
// Reset password
// ============================================================
describe('Reset password', () => {
  it('owner happy path: bcrypt-updates the password, returns the shop slug', async () => {
    await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });
    const token = lastEmailToken();

    const res = await request(app)
      .post('/auth/owner/reset-password')
      .send({ token, password: 'brand-new-password-1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.shopSlug, 'active-shop');
    assert.equal(passwordUpdates.length, 1);
    assert.equal(passwordUpdates[0]?.table, 'shop_owners');
    assert.equal(passwordUpdates[0]?.id, OWNER.id);
    // The stored value is a real bcrypt hash of the new password, not the password.
    assert.ok(await bcrypt.compare('brand-new-password-1', passwordUpdates[0]?.hash ?? ''));
  });

  it('token is single-use: replay returns 400', async () => {
    await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });
    const token = lastEmailToken();

    const first = await request(app)
      .post('/auth/owner/reset-password')
      .send({ token, password: 'brand-new-password-1' });
    assert.equal(first.status, 200);

    const replay = await request(app)
      .post('/auth/owner/reset-password')
      .send({ token, password: 'another-password-2' });
    assert.equal(replay.status, 400);
    assert.equal(passwordUpdates.length, 1);
  });

  it('expired token returns 400 and changes nothing', async () => {
    await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });
    const token = lastEmailToken();
    for (const row of tokens.values()) row.expires_at = new Date(Date.now() - 1000);

    const res = await request(app)
      .post('/auth/owner/reset-password')
      .send({ token, password: 'brand-new-password-1' });

    assert.equal(res.status, 400);
    assert.equal(passwordUpdates.length, 0);
  });

  it('owner token rejected on the barber endpoint (kind mismatch)', async () => {
    await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });
    const token = lastEmailToken();

    const res = await request(app)
      .post('/auth/barber/reset-password')
      .send({ token, password: 'brand-new-password-1' });

    assert.equal(res.status, 400);
    assert.equal(passwordUpdates.length, 0);
  });

  it('garbage token returns the same generic 400', async () => {
    const res = await request(app)
      .post('/auth/owner/reset-password')
      .send({ token: 'a'.repeat(43), password: 'brand-new-password-1' });

    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /invalid or expired/i);
  });

  it('too-short password rejected before touching the token', async () => {
    await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });
    const token = lastEmailToken();

    const res = await request(app).post('/auth/owner/reset-password').send({ token, password: 'short' });

    assert.equal(res.status, 400);
    // Token must still be usable afterwards.
    const retry = await request(app)
      .post('/auth/owner/reset-password')
      .send({ token, password: 'long-enough-password' });
    assert.equal(retry.status, 200);
  });

  it('barber happy path: updates barbers table, shopSlug is null', async () => {
    await request(app).post('/auth/barber/forgot-password').send({ email: BARBER.email });
    const token = lastEmailToken();

    const res = await request(app)
      .post('/auth/barber/reset-password')
      .send({ token, password: 'brand-new-password-1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.shopSlug, null);
    assert.equal(passwordUpdates[0]?.table, 'barbers');
    assert.ok(await bcrypt.compare('brand-new-password-1', passwordUpdates[0]?.hash ?? ''));
  });

  it('requesting a new token voids the previous outstanding one', async () => {
    await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });
    const firstToken = lastEmailToken();
    await request(app).post('/auth/owner/forgot-password').send({ email: OWNER.email });
    const secondToken = lastEmailToken();

    // Consuming the newest token deletes the older outstanding one.
    const res = await request(app)
      .post('/auth/owner/reset-password')
      .send({ token: secondToken, password: 'brand-new-password-1' });
    assert.equal(res.status, 200);

    const stale = await request(app)
      .post('/auth/owner/reset-password')
      .send({ token: firstToken, password: 'another-password-2' });
    assert.equal(stale.status, 400);
  });
});
