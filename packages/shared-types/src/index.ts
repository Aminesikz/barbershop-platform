// Shared DTOs — imported by both apps/api and apps/web

export interface Shop {
  id: string;
  slug: string;
  timezone: string;
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
