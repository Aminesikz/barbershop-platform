-- Dev bootstrap schema for the barbershop platform.
-- NOTE: this is a throwaway local-dev schema to get the API running, NOT a
-- migration. Replace with a real migration tool (e.g. node-pg-migrate) before prod.
-- Columns mirror exactly what the auth queries SELECT/JOIN on.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE shops (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text        NOT NULL UNIQUE,
  name       text,        -- display name; nullable for shops created before this column
  timezone   text        NOT NULL DEFAULT 'Africa/Algiers',
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop_owners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  name          text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Platform super-admins (the software operator). NOT tied to any shop — manages all
-- shops across tenants via the non-tenant-scoped /admin API.
CREATE TABLE platform_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  name          text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE barbers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  name_ar       text        NOT NULL,
  name_en       text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Join table: a barber can belong to multiple shops (multi-tenant).
CREATE TABLE barber_shops (
  barber_id  uuid        NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  shop_id    uuid        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (barber_id, shop_id)
);

CREATE INDEX idx_barber_shops_shop ON barber_shops(shop_id);

-- ============================================================================
-- BOOKING DOMAIN
-- ============================================================================

-- Needed for EXCLUDE constraints that mix '=' on uuid/int/smallint with a range
-- overlap operator (&&). pgcrypto already enabled above for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- updated_at touch trigger, shared by tables below.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- SERVICES — shop-wide; any barber performs any service.
-- price_dzd: WHOLE Algerian dinars (DZD has no circulating subunit). Integer.
-- ---------------------------------------------------------------------------
CREATE TABLE services (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name_ar      text        NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 120),
  name_en      text        CHECK (name_en IS NULL OR char_length(name_en) <= 120),
  duration_min integer     NOT NULL CHECK (duration_min > 0 AND duration_min <= 480),
  price_dzd    integer     NOT NULL CHECK (price_dzd >= 0),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Target for the bookings composite FK (service must belong to the booked shop).
  UNIQUE (id, shop_id)
);
-- Active service names unique per shop; a soft-deleted name can be reused.
CREATE UNIQUE INDEX uq_services_shop_name_active ON services(shop_id, name_ar) WHERE is_active;
CREATE INDEX idx_services_shop_active ON services(shop_id) WHERE is_active;
CREATE TRIGGER trg_services_touch BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- WORKING_HOURS — per barber, per shop, per weekday. Split shifts allowed
-- (multiple rows per weekday). Times = minutes-of-day in shop-LOCAL wall-clock.
-- weekday 0=Sunday..6=Saturday (== Postgres EXTRACT(DOW)).
-- Composite FK makes the barber<->shop pairing a DB invariant (is_active checked in app).
-- ---------------------------------------------------------------------------
CREATE TABLE working_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid     NOT NULL,
  barber_id   uuid     NOT NULL,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min   integer  NOT NULL CHECK (start_min >= 0 AND start_min < 1440),
  end_min     integer  NOT NULL CHECK (end_min > 0 AND end_min <= 1440),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_min > start_min),
  FOREIGN KEY (barber_id, shop_id) REFERENCES barber_shops(barber_id, shop_id) ON DELETE CASCADE,
  CONSTRAINT no_overlapping_shift EXCLUDE USING gist (
    barber_id WITH =, shop_id WITH =, weekday WITH =,
    int4range(start_min, end_min, '[)') WITH &&
  )
);
CREATE INDEX idx_working_hours_lookup ON working_hours(shop_id, barber_id, weekday);

-- ---------------------------------------------------------------------------
-- BARBER_TIME_OFF — PERSON-scoped (applies at all shops). Absolute UTC range.
-- ---------------------------------------------------------------------------
CREATE TABLE barber_time_off (
  id         uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id  uuid       NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  during     tstzrange  NOT NULL,
  reason     text       CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT isempty(during) AND lower(during) IS NOT NULL AND upper(during) IS NOT NULL),
  CONSTRAINT no_overlapping_time_off EXCLUDE USING gist (barber_id WITH =, during WITH &&)
);
CREATE INDEX idx_time_off_barber_range ON barber_time_off USING gist (barber_id, during);

-- ---------------------------------------------------------------------------
-- BOOKINGS — inline customer (no customers table; single redactable PII row).
-- `during` is a STORED generated range so the EXCLUDE guard never depends on app code.
-- customer_phone: E.164, NEVER logged / NEVER broadcast over WS.
-- customer_phone_hmac: keyed HMAC, safe for redis keys / logs.
-- ---------------------------------------------------------------------------
CREATE TABLE bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             uuid        NOT NULL,
  barber_id           uuid        NOT NULL,
  service_id          uuid        NOT NULL,
  customer_name       text        NOT NULL CHECK (char_length(customer_name) BETWEEN 2 AND 80),
  customer_phone      text        NOT NULL CHECK (char_length(customer_phone) <= 20),
  customer_phone_hmac text        NOT NULL,
  customer_email      text        CHECK (customer_email IS NULL OR char_length(customer_email) <= 254),
  start_at            timestamptz NOT NULL,
  duration_min        integer     NOT NULL CHECK (duration_min > 0),
  price_dzd           integer     NOT NULL CHECK (price_dzd >= 0),
  during              tstzrange   NOT NULL,  -- maintained by trg_bookings_during (BEFORE trigger)
  status              text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','completed','cancelled','no_show')),
  source              text        NOT NULL DEFAULT 'public'
                      CHECK (source IN ('public','owner','barber')),
  idempotency_key     uuid        NOT NULL,
  notes               text,
  cancel_reason       text,
  confirmed_at        timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (barber_id, shop_id) REFERENCES barber_shops(barber_id, shop_id) ON DELETE RESTRICT,
  FOREIGN KEY (service_id, shop_id) REFERENCES services(id, shop_id) ON DELETE RESTRICT,
  CONSTRAINT uq_booking_idem UNIQUE (shop_id, idempotency_key),
  -- AUTHORITATIVE double-booking guard: no overlapping LIVE bookings per barber.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    barber_id WITH =, during WITH &&
  ) WHERE (status IN ('pending','confirmed'))
);
CREATE INDEX idx_bookings_barber_day ON bookings(shop_id, barber_id, start_at) WHERE status IN ('pending','confirmed');
CREATE INDEX idx_bookings_shop_day ON bookings(shop_id, start_at);
CREATE INDEX idx_bookings_shop_phone ON bookings(shop_id, customer_phone_hmac);
CREATE TRIGGER trg_bookings_touch BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- `during` is maintained here (not a generated column): timestamptz + interval is
-- STABLE, not IMMUTABLE, so it can't be GENERATED ALWAYS. The BEFORE trigger keeps the
-- range authoritative in the DB regardless of app code, satisfying the EXCLUDE guard.
CREATE OR REPLACE FUNCTION set_booking_during() RETURNS trigger AS $$
BEGIN
  NEW.during := tstzrange(NEW.start_at, NEW.start_at + make_interval(mins => NEW.duration_min), '[)');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_bookings_during
  BEFORE INSERT OR UPDATE OF start_at, duration_min ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_booking_during();

-- ---------------------------------------------------------------------------
-- PASSWORD_RESET_TOKENS — owner/barber password reset (mirrors migration 0002).
-- SECURITY: stores a SHA-256 hash of the token, never the token itself.
-- Exactly one of owner_id/barber_id is set; single-use via used_at.
-- ---------------------------------------------------------------------------
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
