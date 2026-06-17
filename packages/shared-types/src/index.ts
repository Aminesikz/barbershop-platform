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
