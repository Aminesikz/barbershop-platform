// Customer reviews: verified (one-time token emailed when a booking completes)
// and owner-moderated (only 'approved' rows appear publicly).
//
// review_tokens follows the password_reset_tokens pattern: SHA-256 hash only,
// single-use via used_at, TTL via expires_at. One token per booking.
// reviews.customer_name is copied from the booking at submit time; the public
// API abbreviates it — the full name stays owner-facing.

exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE review_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  booking_id    uuid        NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  barber_id     uuid        NOT NULL,
  customer_name text        NOT NULL CHECK (char_length(customer_name) BETWEEN 2 AND 80),
  rating        smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       text        CHECK (comment IS NULL OR char_length(comment) <= 600),
  status        text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  moderated_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (barber_id, shop_id) REFERENCES barber_shops(barber_id, shop_id) ON DELETE CASCADE
);
CREATE INDEX idx_reviews_shop_status ON reviews(shop_id, status, created_at DESC);
CREATE TRIGGER trg_reviews_touch BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
`);
};

exports.down = (pgm) => {
  pgm.sql(`
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS review_tokens;
`);
};
