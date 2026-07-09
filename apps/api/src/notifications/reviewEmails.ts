import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { eventBus, type BookingCompletedEvent } from '../shared/eventBus.js';
import { isEmailConfigured, sendEmail } from '../shared/email.js';
import { issueReviewToken } from '../modules/reviews/reviews.service.js';

// Review invitation on booking.completed: issue the one-time token and email the
// customer a review link. Runs OFF the request path — completing a booking never
// waits on Resend, and a failure here only logs (status, no PII, no token).
//
// The event is id-only on purpose; the customer email is fetched here from the DB.
// issueReviewToken is idempotent (one token per booking), so a replayed event
// can't produce a second invitation.

interface ReviewEmailRow {
  customer_name: string;
  customer_email: string | null;
  barber_name: string;
  shop_name: string | null;
  shop_slug: string;
}

const REVIEW_EMAIL_SQL = `
  SELECT b.customer_name, b.customer_email,
         COALESCE(ba.name_en, ba.name_ar) AS barber_name,
         s.name AS shop_name, s.slug AS shop_slug
  FROM bookings b
  JOIN barbers ba ON ba.id = b.barber_id
  JOIN shops s ON s.id = b.shop_id
  WHERE b.id = $1 AND b.status = 'completed'`;

/** Review-form URL for a shop: WEB_BASE_URL with the slug prepended as a subdomain. */
function reviewUrl(slug: string, token: string): string {
  const base = new URL(env.WEB_BASE_URL);
  return `${base.protocol}//${slug}.${base.host}/review?token=${token}`;
}

function reviewEmailText(r: ReviewEmailRow, shopName: string, link: string): string {
  return [
    `Hi ${r.customer_name},`,
    '',
    `Thanks for visiting ${shopName}! How was your appointment with ${r.barber_name}?`,
    '',
    'Leave a quick review — it takes less than a minute and helps the shop a lot:',
    '',
    link,
    '',
    'The link is personal to your visit and expires in 30 days.',
    '',
    shopName,
  ].join('\n');
}

async function handleBookingCompleted(event: BookingCompletedEvent): Promise<void> {
  if (!isEmailConfigured()) return;

  const { rows } = await pool.query<ReviewEmailRow>(REVIEW_EMAIL_SQL, [event.bookingId]);
  const row = rows[0];
  if (!row?.customer_email) return; // no email left at booking time — nothing to send

  // null → a token was already issued for this booking (event replay); don't re-email.
  const token = await issueReviewToken(event.shopId, event.bookingId);
  if (!token) return;

  const shopName = row.shop_name ?? row.shop_slug;
  await sendEmail({
    to: row.customer_email,
    subject: `How was your visit to ${shopName}?`,
    text: reviewEmailText(row, shopName, reviewUrl(row.shop_slug, token)),
  });
}

/** Subscribe review-invitation emails to the event bus. Called once at server boot. */
export function registerReviewEmailNotifications(): void {
  eventBus.on('booking.completed', (event) => {
    handleBookingCompleted(event).catch((err: unknown) => {
      console.error(
        'booking.completed review-email handler failed:',
        err instanceof Error ? err.message : err,
      );
    });
  });
}
