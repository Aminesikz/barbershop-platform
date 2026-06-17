import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

interface WsAuthResult {
  barberId: string;
  shopId: string;
  name: string;
}

interface JwtPayload {
  sub: string;
  shopId: string;
  name: string;
}

function isJwtPayload(v: unknown): v is JwtPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['sub'] === 'string' &&
    typeof (v as Record<string, unknown>)['shopId'] === 'string' &&
    typeof (v as Record<string, unknown>)['name'] === 'string'
  );
}

export function wsAuth(req: IncomingMessage, socket: Socket): WsAuthResult | null {
  const url = new URL(req.url ?? '', 'ws://base');
  const token = url.searchParams.get('token');
  const shopIdParam = url.searchParams.get('shopId');

  if (!token || !shopIdParam) {
    socket.destroy();
    return null;
  }

  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch {
    // SECURITY: any invalid/expired token destroys the socket without upgrading
    socket.destroy();
    return null;
  }

  if (!isJwtPayload(decoded)) {
    socket.destroy();
    return null;
  }

  // SECURITY: verify the token's shopId matches the requested shopId to prevent
  // a barber from one shop connecting to another shop's WebSocket channel
  if (decoded.shopId !== shopIdParam) {
    socket.destroy();
    return null;
  }

  return { barberId: decoded.sub, shopId: decoded.shopId, name: decoded.name };
}
