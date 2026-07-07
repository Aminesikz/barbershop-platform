import type {
  BookingDTO,
  PublicBookingDTO,
  BookingBroadcastDTO,
  BookingStatus,
  BookingSource,
} from '@barber/shared-types';

/** Raw bookings-table row (no joins). Includes customer_phone — staff only, never logged. */
export interface BookingRow {
  id: string;
  shop_id: string;
  barber_id: string;
  service_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  start_at: Date;
  end_at: Date;
  status: BookingStatus;
  source: BookingSource;
  cancel_reason: string | null;
  confirmed_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
}

/** Booking joined with barber + service names — for public/broadcast (no phone). */
export interface BookingFullRow {
  id: string;
  barber_id: string;
  service_id: string;
  customer_name: string;
  start_at: Date;
  end_at: Date;
  status: BookingStatus;
  barber_name_ar: string;
  barber_name_en: string | null;
  service_name_ar: string;
  service_name_en: string | null;
}

/** Full staff DTO — INCLUDES customerPhone. Callers must never log it. */
export function toBookingDTO(r: BookingRow): BookingDTO {
  return {
    id: r.id,
    shopId: r.shop_id,
    barberId: r.barber_id,
    serviceId: r.service_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    start: r.start_at.toISOString(),
    end: r.end_at.toISOString(),
    status: r.status,
    source: r.source,
    cancelReason: r.cancel_reason,
    confirmedAt: r.confirmed_at?.toISOString() ?? null,
    completedAt: r.completed_at?.toISOString() ?? null,
    cancelledAt: r.cancelled_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

/** Public confirmation — NO phone. */
export function toPublicDTO(r: BookingFullRow): PublicBookingDTO {
  return {
    id: r.id,
    status: r.status,
    start: r.start_at.toISOString(),
    end: r.end_at.toISOString(),
    barber: { nameAr: r.barber_name_ar, nameEn: r.barber_name_en },
    service: { nameAr: r.service_name_ar, nameEn: r.service_name_en },
  };
}

/** Redacted WebSocket payload — NO phone. */
export function toBroadcastDTO(r: BookingFullRow): BookingBroadcastDTO {
  return {
    id: r.id,
    barberId: r.barber_id,
    serviceId: r.service_id,
    customerName: r.customer_name,
    start: r.start_at.toISOString(),
    end: r.end_at.toISOString(),
    status: r.status,
  };
}
