import bcrypt from 'bcrypt';
import { pool } from '../../config/db.js';

// SECURITY: password_hash is never returned from this file.

interface AdminRow {
  id: string;
  password_hash: string;
  name: string;
}

export interface AdminLoginResult {
  id: string;
  name: string;
}

export async function verifyAdminCredentials(
  email: string,
  password: string,
): Promise<AdminLoginResult | null> {
  const result = await pool.query<AdminRow>(
    'SELECT id, password_hash, name FROM platform_admins WHERE email = $1 AND is_active',
    [email],
  );

  const admin = result.rows[0];
  // Always run bcrypt.compare to avoid a timing oracle, even when no row matched.
  const hashToCompare =
    admin?.password_hash ?? '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const match = await bcrypt.compare(password, hashToCompare);

  if (!admin || !match) return null;
  return { id: admin.id, name: admin.name };
}
