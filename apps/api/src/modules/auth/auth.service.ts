import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { env } from '../../config/env.js';

// SECURITY: password_hash is never returned from any function in this file.

interface OwnerRow {
  id: string;
  shop_id: string;
  password_hash: string;
  name: string;
}

interface OwnerLoginResult {
  id: string;
  shopId: string;
  name: string;
}

export async function verifyOwnerCredentials(
  email: string,
  password: string,
): Promise<OwnerLoginResult | null> {
  const result = await pool.query<OwnerRow>(
    'SELECT id, shop_id, password_hash, name FROM shop_owners WHERE email = $1',
    [email],
  );

  const owner = result.rows[0];

  // Always run bcrypt.compare to prevent timing oracle, even when owner not found
  const hashToCompare = owner?.password_hash ?? '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const match = await bcrypt.compare(password, hashToCompare);

  if (!owner || !match) {
    return null;
  }

  return { id: owner.id, shopId: owner.shop_id, name: owner.name };
}

interface BarberRow {
  id: string;
  password_hash: string;
  name_ar: string;
  name_en: string | null;
  shop_active: boolean;
}

interface BarberLoginResult {
  token: string;
  barber: {
    id: string;
    name: string;
    shopId: string;
  };
}

export async function verifyBarberCredentials(
  email: string,
  password: string,
  shopId: string,
): Promise<BarberLoginResult | null> {
  const result = await pool.query<BarberRow>(
    `SELECT b.id, b.password_hash, b.name_ar, b.name_en, bs.is_active AS shop_active
     FROM barbers b
     JOIN barber_shops bs ON bs.barber_id = b.id
     WHERE b.email = $1 AND bs.shop_id = $2 AND b.is_active = true`,
    [email, shopId],
  );

  const barber = result.rows[0];

  // Always run bcrypt.compare to prevent timing oracle
  const hashToCompare = barber?.password_hash ?? '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const match = await bcrypt.compare(password, hashToCompare);

  if (!barber || !match || !barber.shop_active) {
    return null;
  }

  const name = barber.name_en ?? barber.name_ar;
  // JWT_EXPIRES_IN is a duration string (e.g. "8h") validated by Zod at startup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = jwt.sign({ sub: barber.id, shopId, name }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });

  return {
    token,
    barber: { id: barber.id, name, shopId },
  };
}
