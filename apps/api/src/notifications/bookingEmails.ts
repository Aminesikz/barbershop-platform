import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { eventBus, type BookingCreatedEvent } from '../shared/eventBus.js';
import { isEmailConfigured, sendEmail } from '../shared/email.js';

// Email notifications on booking.created: one to each active shop owner, one to
// the customer when they left an email. Runs OFF the request path — the booking
// response never waits on Resend, and a failure here only logs (status, no PII).
//
// The eventBus payload is the REDACTED broadcast DTO on purpose; everything
// PII-adjacent (customer email, owner emails) is fetched here from the DB so the
// event itself stays safe to fan out.

interface BookingEmailRow {
  customer_name: string;
  customer_email: string | null;
  price_dzd: number;
  start_at: Date;
  barber_name: string;
  service_name: string;
  shop_name: string | null;
  shop_slug: string;
  shop_timezone: string;
}

const BOOKING_EMAIL_SQL = `
  SELECT b.customer_name, b.customer_email, b.price_dzd, lower(b.during) AS start_at,
         COALESCE(ba.name_en, ba.name_ar) AS barber_name,
         COALESCE(se.name_en, se.name_ar) AS service_name,
         s.name AS shop_name, s.slug AS shop_slug, s.timezone AS shop_timezone
  FROM bookings b
  JOIN barbers ba ON ba.id = b.barber_id
  JOIN services se ON se.id = b.service_id
  JOIN shops s ON s.id = b.shop_id
  WHERE b.id = $1`;

/** Format an instant as shop-local wall-clock, e.g. "Tuesday, 14 July 2026, 16:30". */
function formatShopTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** Console URL for a shop: WEB_BASE_URL with the slug prepended as a subdomain. */
function consoleUrl(slug: string): string {
  const base = new URL(env.WEB_BASE_URL);
  return `${base.protocol}//${slug}.${base.host}/business`;
}

function ownerEmailText(r: BookingEmailRow, shopName: string): string {
  return [
    'Hi,',
    '',
    `You have a new booking request at ${shopName}:`,
    '',
    `  Customer: ${r.customer_name}`,
    `  Service:  ${r.service_name}`,
    `  Barber:   ${r.barber_name}`,
    `  When:     ${formatShopTime(r.start_at, r.shop_timezone)}`,
    `  Price:    ${r.price_dzd} DZD`,
    '',
    `Open your console to confirm it: ${consoleUrl(r.shop_slug)}`,
  ].join('\n');
}

function customerEmailText(r: BookingEmailRow, shopName: string): string {
  return [
    `Hi ${r.customer_name},`,
    '',
    `We received your booking request at ${shopName}:`,
    '',
    `  Service: ${r.service_name}`,
    `  Barber:  ${r.barber_name}`,
    `  When:    ${formatShopTime(r.start_at, r.shop_timezone)}`,
    `  Price:   ${r.price_dzd} DZD`,
    '',
    'The shop will confirm your appointment shortly. See you there!',
    '',
    shopName,
  ].join('\n');
}

async function handleBookingCreated(event: BookingCreatedEvent): Promise<void> {
  if (!isEmailConfigured()) return;

  const [bookingRes, ownersRes] = await Promise.all([
    pool.query<BookingEmailRow>(BOOKING_EMAIL_SQL, [event.booking.id]),
    pool.query<{ email: string }>(
      'SELECT email FROM shop_owners WHERE shop_id = $1 AND is_active',
      [event.shopId],
    ),
  ]);
  const row = bookingRes.rows[0];
  if (!row) return; // booking vanished between commit and here — nothing to send

  const shopName = row.shop_name ?? row.shop_slug;
  const sends: Array<Promise<void>> = ownersRes.rows.map((o) =>
    sendEmail({
      to: o.email,
      subject: `New booking at ${shopName}`,
      text: ownerEmailText(row, shopName),
    }),
  );
  if (row.customer_email) {
    sends.push(
      sendEmail({
        to: row.customer_email,
        subject: `Your booking at ${shopName}`,
        text: customerEmailText(row, shopName),
      }),
    );
  }

  const results = await Promise.allSettled(sends);
  for (const r of results) {
    if (r.status === 'rejected') {
      // SECURITY: message only (Resend errors carry a status code, never addresses).
      console.error(
        'booking.created notification email failed:',
        r.reason instanceof Error ? r.reason.message : r.reason,
      );
    }
  }
}

/** Subscribe booking-email notifications to the event bus. Called once at server boot. */
export function registerBookingEmailNotifications(): void {
  eventBus.on('booking.created', (event) => {
    handleBookingCreated(event).catch((err: unknown) => {
      console.error(
        'booking.created notification handler failed:',
        err instanceof Error ? err.message : err,
      );
    });
  });
}
