import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---- Mutable env + captured queries (module mocks must precede the import) ----
const testEnv = {
  BOOKING_PENDING_EXPIRE_HOURS: 24,
  BOOKING_EXPIRY_SWEEP_INTERVAL_MIN: 5,
};

const queries: Array<{ sql: string; params: unknown[] }> = [];
let nextRowCount = 0;
let failQuery = false;

mock.module('../config/env.js', {
  namedExports: { env: testEnv },
});

mock.module('../config/db.js', {
  namedExports: {
    pool: {
      query: async (sql: string, params: unknown[]) => {
        if (failQuery) throw new Error('connection terminated');
        queries.push({ sql, params });
        return { rows: [], rowCount: nextRowCount };
      },
    },
    withTransaction: async () => {
      throw new Error('not used here');
    },
    testConnection: async () => undefined,
  },
});

const { expirePendingBookings, startPendingExpirySweep, EXPIRE_REASON } = await import(
  '../sweeps/pendingExpiry.js'
);

/** startPendingExpirySweep fires its first tick asynchronously — let it settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  queries.length = 0;
  nextRowCount = 0;
  failQuery = false;
  testEnv.BOOKING_PENDING_EXPIRE_HOURS = 24;
});

describe('expirePendingBookings', () => {
  it('cancels only stale PENDING rows, using the configured TTL', async () => {
    testEnv.BOOKING_PENDING_EXPIRE_HOURS = 48;
    nextRowCount = 3;

    const n = await expirePendingBookings();

    assert.equal(n, 3);
    assert.equal(queries.length, 1);
    const q = queries[0];
    assert.ok(q);
    assert.match(q.sql, /UPDATE bookings/);
    assert.match(q.sql, /status = 'cancelled'/);
    assert.match(q.sql, /cancelled_at = now\(\)/);
    // Guards: only pending rows, only past the creation-time cutoff.
    assert.match(q.sql, /WHERE status = 'pending'/);
    assert.match(q.sql, /created_at < now\(\) - make_interval\(hours => \$2\)/);
    assert.deepEqual(q.params, [EXPIRE_REASON, 48]);
  });
});

describe('startPendingExpirySweep', () => {
  it('runs a sweep immediately at boot and returns the interval timer', async () => {
    const timer = startPendingExpirySweep();
    await settle();
    try {
      assert.ok(timer);
      assert.equal(queries.length, 1);
    } finally {
      if (timer) clearInterval(timer);
    }
  });

  it('is disabled when BOOKING_PENDING_EXPIRE_HOURS is 0', async () => {
    testEnv.BOOKING_PENDING_EXPIRE_HOURS = 0;
    const timer = startPendingExpirySweep();
    await settle();
    assert.equal(timer, null);
    assert.equal(queries.length, 0);
  });

  it('a failing sweep logs and never throws (next tick still scheduled)', async () => {
    failQuery = true;
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };

    let timer: NodeJS.Timeout | null = null;
    try {
      timer = startPendingExpirySweep();
      await settle();
    } finally {
      console.error = originalError;
      if (timer) clearInterval(timer);
    }

    assert.ok(timer);
    assert.ok(logged.some((l) => l.includes('pending-expiry sweep failed')));
    assert.ok(logged.some((l) => l.includes('connection terminated')));
  });
});
