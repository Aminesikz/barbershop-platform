import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---- Env stub (must run before any module that imports config/env) ----
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['SESSION_SECRET'] = 'test-session-secret-minimum-32-chars!!';
process.env['JWT_SECRET'] = 'test-jwt-secret-minimum-32-chars!!!!!';
process.env['ALLOWED_ORIGIN_PATTERN'] = '*.platform.dz';
process.env['PHONE_HMAC_SECRET'] = 'test-phone-hmac-secret-minimum-32-chars!!';
process.env['WEB_BASE_URL'] = 'https://dzbarbers.com';

// ---- Fixtures ----
// 2026-07-14T15:30Z = 16:30 in Africa/Algiers (UTC+1, no DST) — the emails must
// show the shop-local wall-clock time, never the UTC instant.
const BOOKING_ROW = {
  customer_name: 'Ali Mansouri',
  customer_email: 'ali@example.com' as string | null,
  price_dzd: 500,
  start_at: new Date('2026-07-14T15:30:00.000Z'),
  barber_name: 'Samir',
  service_name: 'Full Haircut',
  shop_name: 'Algiers Cuts' as string | null,
  shop_slug: 'algiers-cuts',
  shop_timezone: 'Africa/Algiers',
};
const CUSTOMER_PHONE = '+213551234567';

let ownerEmails: string[] = [];
let bookingRow: typeof BOOKING_ROW | null = null;
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
let emailConfigured = true;
let failSendTo: string | null = null;

// ---- Module mocks (before importing the module under test) ----
mock.module('../shared/email.js', {
  namedExports: {
    isEmailConfigured: () => emailConfigured,
    sendEmail: async (input: { to: string; subject: string; text: string }) => {
      if (input.to === failSendTo) throw new Error('Resend API responded 500');
      sentEmails.push(input);
    },
  },
});

mock.module('../config/db.js', {
  namedExports: {
    pool: {
      query: async (sql: string, _params: unknown[]) => {
        if (sql.includes('FROM bookings b')) {
          const rows = bookingRow ? [bookingRow] : [];
          return { rows, rowCount: rows.length };
        }
        if (sql.includes('FROM shop_owners')) {
          const rows = ownerEmails.map((email) => ({ email }));
          return { rows, rowCount: rows.length };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    },
    withTransaction: async () => {
      throw new Error('not used here');
    },
    testConnection: async () => undefined,
  },
});

const { eventBus } = await import('../shared/eventBus.js');
const { registerBookingEmailNotifications } = await import('../notifications/bookingEmails.js');

registerBookingEmailNotifications();

const EVENT = {
  shopId: 'shop-1',
  barberId: 'barber-1',
  booking: {
    id: 'bk-1',
    barberId: 'barber-1',
    serviceId: 'svc-1',
    customerName: 'Ali Mansouri',
    start: '2026-07-14T15:30:00.000Z',
    end: '2026-07-14T16:00:00.000Z',
    status: 'pending' as const,
  },
};

/** The handler is fire-and-forget; drain the microtask/immediate queue so it settles. */
async function emitAndSettle(): Promise<void> {
  eventBus.emit('booking.created', EVENT);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  sentEmails.length = 0;
  ownerEmails = ['owner@shop.dz'];
  bookingRow = { ...BOOKING_ROW };
  emailConfigured = true;
  failSendTo = null;
});

describe('booking.created email notifications', () => {
  it('emails every active owner and the customer', async () => {
    ownerEmails = ['owner@shop.dz', 'partner@shop.dz'];
    await emitAndSettle();

    assert.equal(sentEmails.length, 3);
    const recipients = sentEmails.map((e) => e.to).sort();
    assert.deepEqual(recipients, ['ali@example.com', 'owner@shop.dz', 'partner@shop.dz']);

    const ownerMail = sentEmails.find((e) => e.to === 'owner@shop.dz');
    assert.ok(ownerMail);
    assert.equal(ownerMail.subject, 'New booking at Algiers Cuts');
    assert.match(ownerMail.text, /Ali Mansouri/);
    assert.match(ownerMail.text, /Full Haircut/);
    assert.match(ownerMail.text, /500 DZD/);
    assert.match(ownerMail.text, /https:\/\/algiers-cuts\.dzbarbers\.com\/business/);

    const customerMail = sentEmails.find((e) => e.to === 'ali@example.com');
    assert.ok(customerMail);
    assert.equal(customerMail.subject, 'Your booking at Algiers Cuts');
    assert.match(customerMail.text, /Samir/);
  });

  it('renders shop-LOCAL wall-clock time (16:30 Algiers, not 15:30 UTC)', async () => {
    await emitAndSettle();
    for (const mail of sentEmails) {
      assert.match(mail.text, /16:30/);
      assert.ok(!mail.text.includes('15:30'));
    }
  });

  it('SECURITY: no email ever contains the customer phone', async () => {
    await emitAndSettle();
    assert.ok(sentEmails.length > 0);
    for (const mail of sentEmails) {
      assert.ok(!mail.text.includes(CUSTOMER_PHONE));
      assert.ok(!mail.text.includes('551234567'));
    }
  });

  it('skips the customer email when none was provided', async () => {
    bookingRow = { ...BOOKING_ROW, customer_email: null };
    await emitAndSettle();
    assert.deepEqual(
      sentEmails.map((e) => e.to),
      ['owner@shop.dz'],
    );
  });

  it('sends nothing when email is not configured', async () => {
    emailConfigured = false;
    await emitAndSettle();
    assert.equal(sentEmails.length, 0);
  });

  it('sends nothing when the booking row is gone', async () => {
    bookingRow = null;
    await emitAndSettle();
    assert.equal(sentEmails.length, 0);
  });

  it('one failed send does not stop the others (and never throws)', async () => {
    const originalError = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };
    try {
      failSendTo = 'owner@shop.dz';
      await emitAndSettle();
    } finally {
      console.error = originalError;
    }

    // Customer email still went out despite the owner send failing.
    assert.deepEqual(
      sentEmails.map((e) => e.to),
      ['ali@example.com'],
    );
    // Failure was logged by status message only — no recipient address leaked.
    assert.ok(logged.some((l) => l.includes('Resend API responded 500')));
    assert.ok(!logged.some((l) => l.includes('owner@shop.dz')));
  });

  it('falls back to the slug when the shop has no display name', async () => {
    bookingRow = { ...BOOKING_ROW, shop_name: null };
    await emitAndSettle();
    const ownerMail = sentEmails.find((e) => e.to === 'owner@shop.dz');
    assert.ok(ownerMail);
    assert.equal(ownerMail.subject, 'New booking at algiers-cuts');
  });
});
