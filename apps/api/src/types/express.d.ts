import 'express-session';
import type { StaffPrincipal } from '../shared/principal.js';

declare module 'express-session' {
  interface SessionData {
    owner?: {
      id: string;
      shopId: string;
      name: string;
    };
    // Platform super-admin (separate boundary; never carries a shopId).
    platformAdmin?: {
      id: string;
      name: string;
    };
  }
}

declare module 'express' {
  interface Request {
    shop?: {
      id: string;
      slug: string;
      timezone: string;
      name: string | null;
    };
    barber?: {
      id: string;
      shopId: string;
      name: string;
    };
    // Set by requireStaff (owner session OR barber JWT, scoped to req.shop).
    staff?: StaffPrincipal;
  }
}
