import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcrypt';
import session, { type SessionData } from 'express-session';

// ---- Env stub (must run before any module that imports config/env) ----
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3000';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['SESSION_SECRET'] = 'test-session-secret-minimum-32-chars!!';
process.env['JWT_SECRET'] = 'test-jwt-secret-minimum-32-chars!!!!!';
process.env['ALLOWED_ORIGIN_PATTERN'] = '*.platform.dz';
process.env['PHONE_HMAC_SECRET'] = 'test-phone-hmac-secret-minimum-32-chars!!';
process.env['WEB_BASE_URL'] = 'https://dzbarbers.com';

// ---- Fixtures ----
const ownerHash = await bcrypt.hash('owner-pass', 12);
const barberHash = await bcrypt.hash('barber-pass', 12);
const SHOP_ID = '00000000-0000-0000-0000-0000000000a1';
const OTHER_SHOP_ID = '00000000-0000-0000-0000-0000000000a2';
const BARBER_ID = '11111111-1111-1111-1111-111111111111';
const BOOKING_ID = '33333333-3333-3333-3333-333333333333';

interface TokenRow {
  id: string;
  shop_id: string;
  booking_id: string;
  expires_at: Date;
  used_at: Date | null;
}

interface ReviewRow {
  id: string;
  shop_id: string;
  booking_id: string;
  barber_id: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: Date;
  moderated_at: Date | null;
}

// In-memory stand-ins for review_tokens / reviews and the completed booking.
const tokensByHash = new Map<string, TokenRow>();
const reviews = new Map<string, ReviewRow>();
let booking: {
  id: string;
  shop_id: string;
  barber_id: string;
  customer_name: string;
  customer_email: string | null;
  status: string;
} | null = null;
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
let emailConfigured = true;
let seq = 0;

// In-memory session store so a login persists into the next request (agent keeps the cookie).
const sessions = new Map<string, SessionData>();

function reviewRowOut(r: ReviewRow): Omit<ReviewRow, 'shop_id'> {
  const { shop_id: _shopId, ...rest } = r;
  return rest;
}

function approvedFor(shopId: string): ReviewRow[] {
  return [...reviews.values()].filter((r) => r.shop_id === shopId && r.status === 'approved');
}

function avgOf(rows: ReviewRow[]): string | null {
  if (rows.length === 0) return null;
  const avg = rows.reduce((sum, r) => sum + r.rating, 0) / rows.length;
  return avg.toFixed(1);
}

// ---- Module mocks (before importing the app) ----
mock.module('../shared/email.js', {
  namedExports: {
    isEmailConfigured: () => emailConfigured,
    sendEmail: async (input: { to: string; subject: string; text: string }) => {
      sentEmails.push(input);
    },
  },
});

function queryHandler(sql: string, params: unknown[]): { rows: unknown[]; rowCount: number } {
  // tenantResolver: slug → shop
  if (sql.includes('FROM shops WHERE slug')) {
    if (params[0] === 'algiers-cuts') {
      return {
        rows: [{ id: SHOP_ID, slug: 'algiers-cuts', timezone: 'Africa/Algiers', name: 'Algiers Cuts', is_active: true }],
        rowCount: 1,
      };
    }
    if (params[0] === 'other-shop') {
      return {
        rows: [{ id: OTHER_SHOP_ID, slug: 'other-shop', timezone: 'Africa/Algiers', name: 'Other Shop', is_active: true }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  // Owner login
  if (sql.includes('FROM shop_owners WHERE email')) {
    const rows =
      params[0] === 'owner@test.dz'
        ? [{ id: 'owner-1', shop_id: SHOP_ID, password_hash: ownerHash, name: 'Owner' }]
        : [];
    return { rows, rowCount: rows.length };
  }

  // Barber login
  if (sql.includes('shop_active')) {
    const rows =
      params[0] === 'barber@test.dz' && params[1] === SHOP_ID
        ? [{ id: BARBER_ID, password_hash: barberHash, name_ar: 'سمير', name_en: 'Samir', shop_active: true }]
        : [];
    return { rows, rowCount: rows.length };
  }

  // Booking complete/confirm transition (UPDATE bookings ... RETURNING RAW_COLS).
  // Owner-path params: [toStatus, id, shopId, fromStatuses[]].
  if (sql.includes('UPDATE bookings SET')) {
    const [status] = params as [string];
    if (!booking || params[1] !== booking.id) return { rows: [], rowCount: 0 };
    booking.status = status;
    return {
      rows: [
        {
          id: booking.id,
          shop_id: booking.shop_id,
          barber_id: booking.barber_id,
          service_id: 'svc-1',
          customer_name: booking.customer_name,
          customer_phone: '+213551234567',
          customer_email: booking.customer_email,
          start_at: new Date('2026-07-08T10:00:00.000Z'),
          end_at: new Date('2026-07-08T10:30:00.000Z'),
          status,
          source: 'public',
          cancel_reason: null,
          confirmed_at: new Date(),
          completed_at: new Date(),
          cancelled_at: null,
          created_at: new Date(),
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes('SELECT 1 FROM bookings')) {
    return { rows: [], rowCount: 0 };
  }

  // reviewEmails handler: completed-booking row
  if (sql.includes('FROM bookings b') && sql.includes('JOIN shops')) {
    const rows =
      booking && params[0] === booking.id && booking.status === 'completed'
        ? [
            {
              customer_name: booking.customer_name,
              customer_email: booking.customer_email,
              barber_name: 'Samir',
              shop_name: 'Algiers Cuts',
              shop_slug: 'algiers-cuts',
            },
          ]
        : [];
    return { rows, rowCount: rows.length };
  }

  // issueReviewToken (ON CONFLICT (booking_id) DO NOTHING)
  if (sql.includes('INSERT INTO review_tokens')) {
    const [shopId, bookingId, tokenHash, ttlDays] = params as [string, string, string, number];
    const exists = [...tokensByHash.values()].some((t) => t.booking_id === bookingId);
    if (exists) return { rows: [], rowCount: 0 };
    tokensByHash.set(tokenHash, {
      id: `tok-${++seq}`,
      shop_id: shopId,
      booking_id: bookingId,
      expires_at: new Date(Date.now() + ttlDays * 86_400_000),
      used_at: null,
    });
    return { rows: [], rowCount: 1 };
  }

  // getReviewContext (token joined to booking context)
  if (sql.includes('FROM review_tokens t')) {
    const t = tokensByHash.get(params[0] as string);
    const valid = t && t.shop_id === params[1] && t.used_at === null && t.expires_at > new Date();
    const rows =
      valid && booking
        ? [
            {
              customer_name: booking.customer_name,
              start_at: new Date('2026-07-08T10:00:00.000Z'),
              barber_name_ar: 'سمير',
              barber_name_en: 'Samir',
              service_name_ar: 'قص شعر',
              service_name_en: 'Haircut',
            },
          ]
        : [];
    return { rows, rowCount: rows.length };
  }

  // submitReview: lock the token row
  if (sql.includes('FROM review_tokens') && sql.includes('FOR UPDATE')) {
    const t = tokensByHash.get(params[0] as string);
    if (!t || t.shop_id !== params[1]) return { rows: [], rowCount: 0 };
    return {
      rows: [
        {
          id: t.id,
          booking_id: t.booking_id,
          expired_or_used: t.used_at !== null || t.expires_at <= new Date(),
        },
      ],
      rowCount: 1,
    };
  }

  // submitReview: insert the review (UNIQUE booking_id backstop)
  if (sql.includes('INSERT INTO reviews')) {
    const [bookingId, rating, comment, shopId] = params as [string, number, string | null, string];
    if (!booking || booking.id !== bookingId || booking.shop_id !== shopId) {
      return { rows: [], rowCount: 0 };
    }
    if ([...reviews.values()].some((r) => r.booking_id === bookingId)) {
      throw Object.assign(new Error('dup'), { code: '23505', constraint: 'reviews_booking_id_key' });
    }
    // Real UUID shape — the PATCH /:id route Zod-validates the param as a uuid.
    const row: ReviewRow = {
      id: `55555555-5555-4555-8555-${String(++seq).padStart(12, '0')}`,
      shop_id: shopId,
      booking_id: bookingId,
      barber_id: booking.barber_id,
      customer_name: booking.customer_name,
      rating,
      comment,
      status: 'pending',
      created_at: new Date(),
      moderated_at: null,
    };
    reviews.set(row.id, row);
    return { rows: [reviewRowOut(row)], rowCount: 1 };
  }

  // submitReview: consume the token
  if (sql.includes('UPDATE review_tokens SET used_at')) {
    for (const t of tokensByHash.values()) {
      if (t.id === params[0]) t.used_at = new Date();
    }
    return { rows: [], rowCount: 1 };
  }

  // moderateReview
  if (sql.includes('UPDATE reviews r SET status')) {
    const [status, id, shopId] = params as [ReviewRow['status'], string, string];
    const row = reviews.get(id);
    if (!row || row.shop_id !== shopId) return { rows: [], rowCount: 0 };
    row.status = status;
    row.moderated_at = new Date();
    return {
      rows: [{ ...reviewRowOut(row), barber_name_ar: 'سمير', barber_name_en: 'Samir' }],
      rowCount: 1,
    };
  }

  // listAllReviews (owner)
  if (sql.includes('FROM reviews r')) {
    const [shopId, status] = params as [string, string?];
    const rows = [...reviews.values()]
      .filter((r) => r.shop_id === shopId && (!status || r.status === status))
      .map((r) => ({ ...reviewRowOut(r), barber_name_ar: 'سمير', barber_name_en: 'Samir' }));
    return { rows, rowCount: rows.length };
  }

  // listPublicReviews: per-barber aggregates, then total, then the list
  if (sql.includes('GROUP BY barber_id')) {
    const byBarber = new Map<string, ReviewRow[]>();
    for (const r of approvedFor(params[0] as string)) {
      byBarber.set(r.barber_id, [...(byBarber.get(r.barber_id) ?? []), r]);
    }
    const rows = [...byBarber.entries()].map(([barberId, rs]) => ({
      barber_id: barberId,
      average: avgOf(rs),
      count: String(rs.length),
    }));
    return { rows, rowCount: rows.length };
  }
  if (sql.includes('avg(rating)')) {
    const rows = approvedFor(params[0] as string);
    return { rows: [{ average: avgOf(rows), count: String(rows.length) }], rowCount: 1 };
  }
  if (sql.includes("status = 'approved'")) {
    const rows = approvedFor(params[0] as string)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map(reviewRowOut);
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

// Import AFTER mocks are wired
const { app } = await import('../app.js');
const { eventBus } = await import('../shared/eventBus.js');
const { registerReviewEmailNotifications } = await import('../notifications/reviewEmails.js');
const { publicDisplayName } = await import('../modules/reviews/reviews.mapper.js');

registerReviewEmailNotifications();

const SLUG = { Host: 'algiers-cuts.platform.dz' };
const OTHER_SLUG = { Host: 'other-shop.platform.dz' };

async function ownerAgent() {
  const agent = request.agent(app);
  const login = await agent.post('/auth/owner/login').send({ email: 'owner@test.dz', password: 'owner-pass' });
  assert.equal(login.status, 200);
  return agent;
}

/** Complete the fixture booking as the owner; drain the fire-and-forget email handler. */
async function completeBookingAndSettle(): Promise<void> {
  const agent = await ownerAgent();
  const res = await agent.patch(`/api/bookings/${BOOKING_ID}/complete`).set(SLUG);
  assert.equal(res.status, 200);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

function lastEmailToken(): string {
  const text = sentEmails[sentEmails.length - 1]?.text ?? '';
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  assert.ok(match, 'review email should contain a token');
  return match[1] as string;
}

beforeEach(() => {
  tokensByHash.clear();
  reviews.clear();
  sentEmails.length = 0;
  sessions.clear();
  emailConfigured = true;
  booking = {
    id: BOOKING_ID,
    shop_id: SHOP_ID,
    barber_id: BARBER_ID,
    customer_name: 'Yacine Benali',
    customer_email: 'yacine@example.com',
    status: 'confirmed',
  };
});

// ============================================================
// Public display-name abbreviation (pure mapper)
// ============================================================
describe('publicDisplayName', () => {
  it('abbreviates the last name to an initial', () => {
    assert.equal(publicDisplayName('Yacine Benali'), 'Yacine B.');
    assert.equal(publicDisplayName('Ali Ben Salah'), 'Ali S.');
  });
  it('keeps a single-word name as-is', () => {
    assert.equal(publicDisplayName('Yacine'), 'Yacine');
  });
});

// ============================================================
// Review invitation email on booking completion
// ============================================================
describe('review invitation email', () => {
  it('completing a booking emails the customer a one-time review link', async () => {
    await completeBookingAndSettle();

    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0]?.to, 'yacine@example.com');
    assert.equal(sentEmails[0]?.subject, 'How was your visit to Algiers Cuts?');
    const token = lastEmailToken();
    // Whole-line equality (never substring-match URLs — CodeQL).
    const linkLine = sentEmails[0]?.text.split('\n').find((l) => l.startsWith('https://'));
    assert.equal(linkLine, `https://algiers-cuts.dzbarbers.com/review?token=${token}`);
  });

  it('confirming (not completing) sends no review email', async () => {
    booking!.status = 'pending';
    const agent = await ownerAgent();
    const res = await agent.patch(`/api/bookings/${BOOKING_ID}/confirm`).set(SLUG);
    assert.equal(res.status, 200);
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sentEmails.length, 0);
  });

  it('no customer email → no review email (and no token)', async () => {
    booking!.customer_email = null;
    await completeBookingAndSettle();
    assert.equal(sentEmails.length, 0);
    assert.equal(tokensByHash.size, 0);
  });

  it('a replayed completion event never sends a second invitation', async () => {
    await completeBookingAndSettle();
    eventBus.emit('booking.completed', { shopId: SHOP_ID, bookingId: BOOKING_ID });
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sentEmails.length, 1);
    assert.equal(tokensByHash.size, 1);
  });

  it('email not configured → nothing sent, nothing issued', async () => {
    emailConfigured = false;
    await completeBookingAndSettle();
    assert.equal(sentEmails.length, 0);
    assert.equal(tokensByHash.size, 0);
  });
});

// ============================================================
// Public: token context + submission
// ============================================================
describe('review submission', () => {
  it('happy path: context → submit → pending review with abbreviated public name', async () => {
    await completeBookingAndSettle();
    const token = lastEmailToken();

    const ctx = await request(app).get(`/api/reviews/context?token=${token}`).set(SLUG);
    assert.equal(ctx.status, 200);
    assert.equal(ctx.body.context.customerName, 'Yacine Benali');
    assert.equal(ctx.body.context.barber.nameEn, 'Samir');
    assert.equal(ctx.body.context.service.nameEn, 'Haircut');

    const res = await request(app)
      .post('/api/reviews')
      .set(SLUG)
      .send({ token, rating: 5, comment: 'Best fade in Algiers.' });
    assert.equal(res.status, 201);
    assert.equal(res.body.review.rating, 5);
    assert.equal(res.body.review.comment, 'Best fade in Algiers.');
    // Public shape: abbreviated name, no booking linkage.
    assert.equal(res.body.review.customerName, 'Yacine B.');
    assert.equal(res.body.review.bookingId, undefined);
  });

  it('garbage token → generic 400 on both context and submit', async () => {
    const ctx = await request(app).get(`/api/reviews/context?token=${'a'.repeat(43)}`).set(SLUG);
    assert.equal(ctx.status, 400);

    const res = await request(app)
      .post('/api/reviews')
      .set(SLUG)
      .send({ token: 'a'.repeat(43), rating: 5 });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /invalid or expired/i);
  });

  it('token is single-use: second submit returns 400 and no second review', async () => {
    await completeBookingAndSettle();
    const token = lastEmailToken();

    const first = await request(app).post('/api/reviews').set(SLUG).send({ token, rating: 4 });
    assert.equal(first.status, 201);

    const replay = await request(app).post('/api/reviews').set(SLUG).send({ token, rating: 1 });
    assert.equal(replay.status, 400);
    assert.equal(reviews.size, 1);
  });

  it('expired token → 400', async () => {
    await completeBookingAndSettle();
    const token = lastEmailToken();
    for (const t of tokensByHash.values()) t.expires_at = new Date(Date.now() - 1000);

    const res = await request(app).post('/api/reviews').set(SLUG).send({ token, rating: 5 });
    assert.equal(res.status, 400);
    assert.equal(reviews.size, 0);
  });

  it("SECURITY: another shop can't use this shop's token (tenant scope)", async () => {
    await completeBookingAndSettle();
    const token = lastEmailToken();

    const ctx = await request(app).get(`/api/reviews/context?token=${token}`).set(OTHER_SLUG);
    assert.equal(ctx.status, 400);

    const res = await request(app).post('/api/reviews').set(OTHER_SLUG).send({ token, rating: 5 });
    assert.equal(res.status, 400);
    assert.equal(reviews.size, 0);
  });

  it('rating out of 1..5 and extra fields are rejected (strict schema)', async () => {
    await completeBookingAndSettle();
    const token = lastEmailToken();

    for (const bad of [
      { token, rating: 0 },
      { token, rating: 6 },
      { token, rating: 4.5 },
      { token, rating: 5, admin: true },
    ]) {
      const res = await request(app).post('/api/reviews').set(SLUG).send(bad);
      assert.equal(res.status, 400);
    }
    assert.equal(reviews.size, 0);
  });

  it('empty comment is stored as null', async () => {
    await completeBookingAndSettle();
    const token = lastEmailToken();
    const res = await request(app).post('/api/reviews').set(SLUG).send({ token, rating: 3, comment: '  ' });
    assert.equal(res.status, 201);
    assert.equal(res.body.review.comment, null);
  });
});

// ============================================================
// Owner moderation + public visibility
// ============================================================
describe('review moderation', () => {
  async function submitOne(): Promise<string> {
    await completeBookingAndSettle();
    const token = lastEmailToken();
    const res = await request(app)
      .post('/api/reviews')
      .set(SLUG)
      .send({ token, rating: 5, comment: 'Great cut.' });
    assert.equal(res.status, 201);
    return res.body.review.id as string;
  }

  it('pending reviews are NOT public; approval publishes them with real aggregates', async () => {
    const id = await submitOne();

    const before = await request(app).get('/api/reviews').set(SLUG);
    assert.equal(before.status, 200);
    assert.deepEqual(before.body.reviews, []);
    assert.equal(before.body.summary.count, 0);
    assert.equal(before.body.summary.average, null);

    const agent = await ownerAgent();
    const mod = await agent.patch(`/api/reviews/${id}`).set(SLUG).send({ status: 'approved' });
    assert.equal(mod.status, 200);
    assert.equal(mod.body.review.status, 'approved');

    const after = await request(app).get('/api/reviews').set(SLUG);
    assert.equal(after.body.summary.count, 1);
    assert.equal(after.body.summary.average, 5);
    assert.equal(after.body.summary.barbers[0].barberId, BARBER_ID);
    assert.equal(after.body.reviews[0].customerName, 'Yacine B.');
  });

  it('rejecting an approved review hides it again', async () => {
    const id = await submitOne();
    const agent = await ownerAgent();
    await agent.patch(`/api/reviews/${id}`).set(SLUG).send({ status: 'approved' });
    await agent.patch(`/api/reviews/${id}`).set(SLUG).send({ status: 'rejected' });

    const pub = await request(app).get('/api/reviews').set(SLUG);
    assert.equal(pub.body.summary.count, 0);
    assert.deepEqual(pub.body.reviews, []);
  });

  it('owner list shows the FULL customer name and every status', async () => {
    await submitOne();
    const agent = await ownerAgent();
    const res = await agent.get('/api/reviews/all').set(SLUG);
    assert.equal(res.status, 200);
    assert.equal(res.body.reviews.length, 1);
    assert.equal(res.body.reviews[0].customerName, 'Yacine Benali');
    assert.equal(res.body.reviews[0].status, 'pending');
    assert.equal(res.body.reviews[0].barberName.nameEn, 'Samir');
  });

  it('moderation requires an owner session: anonymous and barber JWT get 401', async () => {
    const id = await submitOne();

    const anon = await request(app).patch(`/api/reviews/${id}`).set(SLUG).send({ status: 'approved' });
    assert.equal(anon.status, 401);

    const login = await request(app)
      .post('/auth/barber/login')
      .send({ email: 'barber@test.dz', password: 'barber-pass', shopId: SHOP_ID });
    assert.equal(login.status, 200);

    const asBarber = await request(app)
      .patch(`/api/reviews/${id}`)
      .set(SLUG)
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ status: 'approved' });
    assert.equal(asBarber.status, 401);

    const list = await request(app)
      .get('/api/reviews/all')
      .set(SLUG)
      .set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(list.status, 401);
  });

  it('unknown review id → 404; bad status value → 400', async () => {
    const agent = await ownerAgent();
    const missing = await agent
      .patch('/api/reviews/44444444-4444-4444-4444-444444444444')
      .set(SLUG)
      .send({ status: 'approved' });
    assert.equal(missing.status, 404);

    const id = await submitOne();
    const bad = await agent.patch(`/api/reviews/${id}`).set(SLUG).send({ status: 'deleted' });
    assert.equal(bad.status, 400);
  });
});
