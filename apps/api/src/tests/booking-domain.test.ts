import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---- Env stub (must run before importing any module that pulls in config/env) ----
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['SESSION_SECRET'] = 'test-session-secret-minimum-32-chars!!';
process.env['JWT_SECRET'] = 'test-jwt-secret-minimum-32-chars!!!!!';
process.env['ALLOWED_ORIGIN_PATTERN'] = '*.platform.dz';
process.env['PHONE_HMAC_SECRET'] = 'test-phone-hmac-secret-minimum-32-chars!!';

// These modules are pure (no DB/redis connection on import).
const { normalizeDzPhone, hmacPhone } = await import('../shared/phone.js');
const { toPublicDTO, toBroadcastDTO, toBookingDTO } = await import('../modules/bookings/bookings.mapper.js');
const { assertCanManageBarber } = await import('../shared/manageBarber.js');
const { rangesOverlap } = await import('../shared/time.js');
const { algerianPhone, calendarDate, emailAddress } = await import('../shared/validation.js');
const { AppError } = await import('../shared/httpError.js');

// ============================================================
// Phone normalization (Algerian mobile → E.164)
// ============================================================
describe('normalizeDzPhone', () => {
  it('normalizes national 0-prefixed form', () => {
    assert.equal(normalizeDzPhone('0551234567'), '+213551234567');
  });
  it('accepts +213, 213, 00213 and ignores separators', () => {
    assert.equal(normalizeDzPhone('+213551234567'), '+213551234567');
    assert.equal(normalizeDzPhone('213551234567'), '+213551234567');
    assert.equal(normalizeDzPhone('00213551234567'), '+213551234567');
    assert.equal(normalizeDzPhone('0551 23 45 67'), '+213551234567');
    assert.equal(normalizeDzPhone('055-123-4567'), '+213551234567');
  });
  it('accepts 5/6/7 mobile prefixes', () => {
    assert.equal(normalizeDzPhone('0661234567'), '+213661234567');
    assert.equal(normalizeDzPhone('0771234567'), '+213771234567');
  });
  it('rejects non-mobile / malformed numbers', () => {
    assert.equal(normalizeDzPhone('12345'), null);
    assert.equal(normalizeDzPhone('0451234567'), null); // 4 is not a mobile prefix
    assert.equal(normalizeDzPhone('055123456'), null); // too short
    assert.equal(normalizeDzPhone('05512345678'), null); // too long
    assert.equal(normalizeDzPhone('+1 555 123 4567'), null);
  });
});

describe('hmacPhone', () => {
  it('is deterministic and a 64-char hex digest', () => {
    const a = hmacPhone('+213551234567');
    const b = hmacPhone('+213551234567');
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
  it('differs for different numbers', () => {
    assert.notEqual(hmacPhone('+213551234567'), hmacPhone('+213551234568'));
  });
});

// ============================================================
// PII redaction in DTO mappers
// ============================================================
describe('booking mappers — PII redaction', () => {
  const fullRow = {
    id: 'b1',
    barber_id: 'ba1',
    service_id: 's1',
    customer_name: 'Ali',
    start_at: new Date('2026-06-18T08:00:00.000Z'),
    end_at: new Date('2026-06-18T08:30:00.000Z'),
    status: 'pending' as const,
    barber_name_ar: 'سمير',
    barber_name_en: 'Samir',
    service_name_ar: 'قص شعر',
    service_name_en: 'Haircut',
  };
  const rawRow = {
    id: 'b1',
    shop_id: 'sh1',
    barber_id: 'ba1',
    service_id: 's1',
    customer_name: 'Ali',
    customer_phone: '+213551234567',
    customer_email: 'ali@example.com',
    start_at: new Date('2026-06-18T08:00:00.000Z'),
    end_at: new Date('2026-06-18T08:30:00.000Z'),
    status: 'pending' as const,
    source: 'public' as const,
    cancel_reason: null,
    confirmed_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: new Date('2026-06-17T00:00:00.000Z'),
  };

  it('public DTO contains NO phone', () => {
    const dto = toPublicDTO(fullRow);
    assert.ok(!JSON.stringify(dto).includes('551234567'));
    assert.ok(!('customerPhone' in dto));
    assert.equal(dto.barber.nameEn, 'Samir');
  });

  it('broadcast DTO contains NO phone and NO email (compiler-enforced shape)', () => {
    const dto = toBroadcastDTO(fullRow);
    assert.ok(!JSON.stringify(dto).includes('551234567'));
    assert.ok(!JSON.stringify(dto).includes('ali@example.com'));
    assert.ok(!('customerPhone' in dto));
    assert.ok(!('customerEmail' in dto));
    assert.equal(dto.customerName, 'Ali');
  });

  it('staff DTO DOES include phone and email (staff-only)', () => {
    const dto = toBookingDTO(rawRow);
    assert.equal(dto.customerPhone, '+213551234567');
    assert.equal(dto.customerEmail, 'ali@example.com');
    assert.equal(dto.start, '2026-06-18T08:00:00.000Z');
  });
});

// ============================================================
// Authorization: assertCanManageBarber
// ============================================================
describe('assertCanManageBarber', () => {
  const owner = { kind: 'owner' as const, id: 'o1', shopId: 'sh1', name: 'Owner' };
  const barber = { kind: 'barber' as const, id: 'ba1', shopId: 'sh1', name: 'Barber' };

  it('owner may manage any barber', () => {
    assert.doesNotThrow(() => assertCanManageBarber(owner, 'ba1'));
    assert.doesNotThrow(() => assertCanManageBarber(owner, 'ba2'));
  });
  it('barber may manage only self', () => {
    assert.doesNotThrow(() => assertCanManageBarber(barber, 'ba1'));
  });
  it('barber managing another barber throws 403', () => {
    assert.throws(
      () => assertCanManageBarber(barber, 'ba2'),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    );
  });
});

// ============================================================
// Half-open interval overlap
// ============================================================
describe('rangesOverlap (half-open)', () => {
  const d = (s: string) => new Date(`2026-06-18T${s}:00.000Z`);
  it('back-to-back intervals do NOT overlap', () => {
    assert.equal(rangesOverlap(d('10:00'), d('10:30'), d('10:30'), d('11:00')), false);
  });
  it('genuinely overlapping intervals do overlap', () => {
    assert.equal(rangesOverlap(d('10:00'), d('10:30'), d('10:15'), d('10:45')), true);
  });
  it('fully separate intervals do not overlap', () => {
    assert.equal(rangesOverlap(d('10:00'), d('10:30'), d('11:00'), d('11:30')), false);
  });
});

// ============================================================
// Validation primitives
// ============================================================
describe('validation', () => {
  it('algerianPhone parses to E.164 and rejects junk with a STATIC message', () => {
    assert.equal(algerianPhone.parse('0551234567'), '+213551234567');
    const res = algerianPhone.safeParse('12345');
    assert.equal(res.success, false);
    if (!res.success) {
      const msg = JSON.stringify(res.error.issues);
      assert.match(msg, /Invalid phone/);
      // SECURITY: the raw input must not leak into the error.
      assert.ok(!msg.includes('12345'));
    }
  });

  it('emailAddress trims, lowercases and rejects junk', () => {
    assert.equal(emailAddress.parse('  Ali@Example.COM '), 'ali@example.com');
    assert.equal(emailAddress.safeParse('not-an-email').success, false);
    assert.equal(emailAddress.safeParse(`a@${'b'.repeat(250)}.dz`).success, false);
  });

  it('calendarDate rejects impossible dates', () => {
    assert.equal(calendarDate.safeParse('2026-06-18').success, true);
    assert.equal(calendarDate.safeParse('2026-02-30').success, false);
    assert.equal(calendarDate.safeParse('2026-13-01').success, false);
    assert.equal(calendarDate.safeParse('not-a-date').success, false);
  });
});
