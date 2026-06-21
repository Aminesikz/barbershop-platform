/**
 * One-off: create (or update) a platform-admin account.
 *
 * The PRODUCTION database is built by migrations only (not db/02_seed.sql), so it
 * starts with ZERO platform_admins — nobody could log into the admin app to create
 * shops. Run this ONCE after migrations on a fresh DB. Re-running with the same
 * ADMIN_EMAIL just resets the password (handy for a forgotten password).
 *
 * Usage (after `npm run migrate:up`):
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-password' npm run seed:admin -w apps/api
 *   (ADMIN_NAME optional; defaults to "Platform Admin")
 *
 * Standalone on purpose: needs only DATABASE_URL + the admin creds, not the full
 * server env, so it can run as a minimal Railway/Render one-off job.
 */
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`seed:admin — ${name} is required`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = requireEnv('DATABASE_URL');
const email = requireEnv('ADMIN_EMAIL');
const password = requireEnv('ADMIN_PASSWORD');
const name = process.env['ADMIN_NAME'] ?? 'Platform Admin';

if (password.length < 8) {
  console.error('seed:admin — ADMIN_PASSWORD must be at least 8 characters');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query<{ email: string; inserted: boolean }>(
    `INSERT INTO platform_admins (email, password_hash, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING email, (xmax = 0) AS inserted`,
    [email, passwordHash, name],
  );
  const row = rows[0];
  if (!row) throw new Error('upsert returned no row');
  console.log(`seed:admin — ${row.inserted ? 'created' : 'updated'} platform admin: ${row.email}`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('seed:admin failed:', err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
