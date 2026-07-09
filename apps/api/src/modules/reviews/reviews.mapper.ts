import type { PublicReviewDTO, ReviewAdminDTO, ReviewStatus } from '@barber/shared-types';

/** Raw reviews-table row. customer_name is the FULL name — owner-facing only. */
export interface ReviewRow {
  id: string;
  booking_id: string;
  barber_id: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  status: ReviewStatus;
  created_at: Date;
  moderated_at: Date | null;
}

/** Review joined with the barber's names — for the owner moderation list. */
export interface ReviewAdminRow extends ReviewRow {
  barber_name_ar: string;
  barber_name_en: string | null;
}

/**
 * Abbreviate a full name for public display: "Yacine Benali" → "Yacine B.".
 * The full customer name never leaves the staff surface.
 */
export function publicDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

export function toPublicReviewDTO(r: ReviewRow): PublicReviewDTO {
  return {
    id: r.id,
    barberId: r.barber_id,
    customerName: publicDisplayName(r.customer_name),
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at.toISOString(),
  };
}

export function toReviewAdminDTO(r: ReviewAdminRow): ReviewAdminDTO {
  return {
    id: r.id,
    bookingId: r.booking_id,
    barberId: r.barber_id,
    barberName: { nameAr: r.barber_name_ar, nameEn: r.barber_name_en },
    customerName: r.customer_name,
    rating: r.rating,
    comment: r.comment,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    moderatedAt: r.moderated_at?.toISOString() ?? null,
  };
}
