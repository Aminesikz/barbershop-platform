import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { env } from './env.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected pg pool error:', err);
});

export async function testConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('Database connected');
  } finally {
    client.release();
  }
}

/**
 * Run `fn` inside a single transaction on one dedicated pooled connection.
 *
 * The rest of the codebase uses `pool.query` directly, where each call may land
 * on a different pooled connection — so a BEGIN/INSERT/COMMIT sequence issued via
 * `pool.query` would silently scatter across connections and NOT be atomic. Any
 * multi-statement flow that must be transactional (booking create, working-hours
 * full-replace, time-off) MUST go through here.
 *
 * `SET LOCAL` timeouts bound how long a single transaction can hold its connection
 * so a stuck row lock can't exhaust the pool (max=20).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure; surface the original error
    }
    throw err;
  } finally {
    client.release();
  }
}

export { pool };
