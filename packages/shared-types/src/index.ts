// Shared DTOs — imported by both apps/api and apps/web

export interface Shop {
  id: string;
  slug: string;
  timezone: string;
  name: string | null; // display name; null for shops created before the column existed
}

export interface OwnerSession {
  id: string;
  shopId: string;
  name: string;
}

export interface BarberToken {
  id: string;
  shopId: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Booking domain DTOs
// ---------------------------------------------------------------------------

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type BookingSource = 'public' | 'owner' | 'barber';

export interface BarberDTO {
  id: string;
  nameAr: string;
  nameEn: string | null;
  /** Owner-written public profile; null until the owner fills it in. */
  role: string | null;
  specialty: string | null;
  bio: string | null;
}

/**
 * Owner-facing barber row — INCLUDES email and the per-shop active flag.
 * Owner-only (returned from the management endpoints, never the public list).
 * `isActive` is `barber_shops.is_active` for THIS shop (membership), not the
 * person-level `barbers.is_active`.
 */
export interface BarberAdminDTO {
  id: string;
  email: string;
  nameAr: string;
  nameEn: string | null;
  role: string | null;
  specialty: string | null;
  bio: string | null;
  isActive: boolean;
  createdAt: string; // ISO-8601 UTC
}

// ---------------------------------------------------------------------------
// Platform admin (cross-tenant, managed by the separate admin app)
// ---------------------------------------------------------------------------

export interface AdminShopDTO {
  id: string;
  slug: string;
  name: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  ownerEmail: string | null;
}

export interface ServiceDTO {
  id: string;
  shopId: string;
  nameAr: string;
  nameEn: string | null;
  durationMin: number;
  priceDzd: number; // whole Algerian dinars
  isActive: boolean;
}

export interface WorkingHourDTO {
  id: string;
  barberId: string;
  weekday: number; // 0=Sunday .. 6=Saturday
  startMin: number; // minute-of-day, shop-local
  endMin: number;
}

export interface TimeOffDTO {
  id: string;
  barberId: string;
  start: string; // ISO-8601 UTC
  end: string; // ISO-8601 UTC
  reason: string | null;
}

export interface AvailabilitySlotDTO {
  start: string; // ISO-8601 UTC
  end: string; // ISO-8601 UTC
}

export interface AvailabilityDTO {
  barberId: string;
  date: string; // YYYY-MM-DD, shop-local
  serviceId: string;
  durationMin: number;
  slots: AvailabilitySlotDTO[];
}

/** Full staff-facing booking — INCLUDES customerPhone (staff only, never logged). */
export interface BookingDTO {
  id: string;
  shopId: string;
  barberId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  start: string; // ISO-8601 UTC
  end: string; // ISO-8601 UTC
  status: BookingStatus;
  source: BookingSource;
  cancelReason: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

/** Public booking confirmation — NO phone, NO internal flags. */
export interface PublicBookingDTO {
  id: string;
  status: BookingStatus;
  start: string;
  end: string;
  barber: { nameAr: string; nameEn: string | null };
  service: { nameAr: string; nameEn: string | null };
}

/**
 * REDACTED WebSocket payload. Referenced by eventBus's BookingCreatedEvent so the
 * phone omission is COMPILER-ENFORCED. MUST NOT contain customerPhone / hmac / idempotencyKey.
 */
export interface BookingBroadcastDTO {
  id: string;
  barberId: string;
  serviceId: string;
  customerName: string;
  start: string;
  end: string;
  status: BookingStatus;
}

// ---------------------------------------------------------------------------
// Reviews — verified (tied to a completed booking via a one-time emailed token)
// and owner-moderated (only 'approved' ever appears publicly).
// ---------------------------------------------------------------------------

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** Public review card — customerName is ABBREVIATED ("Yacine B."), never the full name. */
export interface PublicReviewDTO {
  id: string;
  barberId: string;
  customerName: string;
  rating: number; // 1..5
  comment: string | null;
  createdAt: string; // ISO-8601 UTC
}

/** Aggregates for the public page hero + per-barber cards. Approved reviews only. */
export interface ReviewSummaryDTO {
  average: number | null; // null when count is 0
  count: number;
  barbers: Array<{ barberId: string; average: number; count: number }>;
}

/** Owner-facing moderation row — full customer name (staff only). */
export interface ReviewAdminDTO {
  id: string;
  bookingId: string;
  barberId: string;
  barberName: { nameAr: string; nameEn: string | null };
  customerName: string;
  rating: number;
  comment: string | null;
  status: ReviewStatus;
  createdAt: string;
  moderatedAt: string | null;
}

/** What the /review landing page shows before the customer rates their visit. */
export interface ReviewContextDTO {
  customerName: string;
  start: string; // ISO-8601 UTC — when the completed appointment was
  barber: { nameAr: string; nameEn: string | null };
  service: { nameAr: string; nameEn: string | null };
}
