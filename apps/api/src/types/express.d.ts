import 'express-session';

declare module 'express-session' {
  interface SessionData {
    owner?: {
      id: string;
      shopId: string;
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
    };
    barber?: {
      id: string;
      shopId: string;
      name: string;
    };
  }
}
