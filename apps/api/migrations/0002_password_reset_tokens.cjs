// Password reset tokens for shop owners and barbers.
//
// SECURITY: only a SHA-256 hash of the token is stored — a DB leak cannot be
// replayed as a live reset link. Exactly one of owner_id/barber_id is set
// (enforced by CHECK); single-use via used_at; short expiry enforced in SQL
// at consume time (expires_at > now()).

exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES shop_owners(id) ON DELETE CASCADE,
  barber_id  uuid REFERENCES barbers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(owner_id, barber_id) = 1)
);
CREATE INDEX idx_prt_owner ON password_reset_tokens(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_prt_barber ON password_reset_tokens(barber_id) WHERE barber_id IS NOT NULL;
`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS password_reset_tokens;');
};
