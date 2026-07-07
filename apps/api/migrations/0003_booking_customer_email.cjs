// Optional customer email on bookings, used for the booking-confirmation email.
//
// PII: treated like customer_phone — staff-facing only, never logged and never
// included in WebSocket broadcasts.

exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE bookings
  ADD COLUMN customer_email text
  CHECK (customer_email IS NULL OR char_length(customer_email) <= 254);
`);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE bookings DROP COLUMN IF EXISTS customer_email;');
};
