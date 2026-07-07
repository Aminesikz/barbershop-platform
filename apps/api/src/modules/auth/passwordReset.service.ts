import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { pool, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { sendEmail } from '../../shared/email.js';
import { badRequest } from '../../shared/httpError.js';

// SECURITY: raw tokens exist only in the email link. The DB stores a SHA-256
// hash, so neither a DB leak nor a log line can be replayed as a reset link.
// Tokens are single-use (used_at) and expire after TOKEN_TTL_MIN.

const TOKEN_TTL_MIN = 30;

export type ResetKind = 'owner' | 'barber';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function resetLink(kind: ResetKind, token: string): string {
  return `${env.WEB_BASE_URL}/reset-password?kind=${kind}&token=${token}`;
}

function resetEmailText(name: string, kind: ResetKind, link: string): string {
  return [
    `Hi ${name},`,
    '',
    `Someone requested a password reset for your ${kind} account. If this was you, open the link below within ${TOKEN_TTL_MIN} minutes to choose a new password:`,
    '',
    link,
    '',
    "If you didn't request this, you can safely ignore this email — your password is unchanged.",
  ].join('\n');
}

interface AccountRow {
  id: string;
  email: string;
  name: string;
}

/**
 * Create a reset token for the account with this email and send the link.
 * Silently does nothing when the email matches no active account — the caller
 * always answers 202 so responses don't reveal which emails exist.
 */
export async function requestPasswordReset(kind: ResetKind, email: string): Promise<void> {
  const account =
    kind === 'owner'
      ? await pool.query<AccountRow>(
          'SELECT id, email, name FROM shop_owners WHERE email = $1 AND is_active',
          [email],
        )
      : await pool.query<AccountRow>(
          'SELECT id, email, COALESCE(name_en, name_ar) AS name FROM barbers WHERE email = $1 AND is_active',
          [email],
        );

  const row = account.rows[0];
  if (!row) return;

  const token = crypto.randomBytes(32).toString('base64url');
  const column = kind === 'owner' ? 'owner_id' : 'barber_id';

  await pool.query(
    `INSERT INTO password_reset_tokens (${column}, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [row.id, hashToken(token), TOKEN_TTL_MIN],
  );

  await sendEmail({
    to: row.email,
    subject: 'Reset your password',
    text: resetEmailText(row.name, kind, resetLink(kind, token)),
  });
}

interface TokenRow {
  id: string;
  actor_id: string;
  expired_or_used: boolean;
}

export interface ResetResult {
  /** The owner's shop slug, so the UI can link back to their console. null for barbers. */
  shopSlug: string | null;
}

/**
 * Consume a reset token and set the new password. Token row is locked FOR UPDATE
 * so a double-submit can't consume the same token twice; all outstanding tokens
 * for the account are removed once one succeeds.
 */
export async function performPasswordReset(
  kind: ResetKind,
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  const column = kind === 'owner' ? 'owner_id' : 'barber_id';
  const table = kind === 'owner' ? 'shop_owners' : 'barbers';
  const passwordHash = await bcrypt.hash(newPassword, 12);

  return withTransaction(async (client) => {
    const found = await client.query<TokenRow>(
      `SELECT id, ${column} AS actor_id, (used_at IS NOT NULL OR expires_at <= now()) AS expired_or_used
       FROM password_reset_tokens
       WHERE token_hash = $1 AND ${column} IS NOT NULL
       FOR UPDATE`,
      [hashToken(token)],
    );

    const row = found.rows[0];
    // One static message for every failure mode — a probe can't distinguish
    // "never existed" from "expired" from "already used".
    if (!row || row.expired_or_used) throw badRequest('Invalid or expired reset link');

    const updated = await client.query(
      `UPDATE ${table} SET password_hash = $1 WHERE id = $2 AND is_active`,
      [passwordHash, row.actor_id],
    );
    if (updated.rowCount === 0) throw badRequest('Invalid or expired reset link');

    // Consume this token and void any other outstanding ones for the account.
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await client.query(
      `DELETE FROM password_reset_tokens WHERE ${column} = $1 AND used_at IS NULL AND id <> $2`,
      [row.actor_id, row.id],
    );

    if (kind === 'owner') {
      const shop = await client.query<{ slug: string }>(
        'SELECT s.slug FROM shops s JOIN shop_owners o ON o.shop_id = s.id WHERE o.id = $1',
        [row.actor_id],
      );
      return { shopSlug: shop.rows[0]?.slug ?? null };
    }
    return { shopSlug: null };
  });
}
