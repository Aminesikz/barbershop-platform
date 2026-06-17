import { Server as HttpServer, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { wsAuth } from './ws.auth.js';
import * as rooms from './ws.rooms.js';
import { eventBus } from '../shared/eventBus.js';

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

export function attachWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const auth = wsAuth(req, socket);
    if (!auth) return; // wsAuth already destroyed the socket

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, auth);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, auth: { barberId: string; shopId: string; name: string }) => {
    const { barberId, shopId } = auth;

    rooms.join(`shop:${shopId}`, ws);
    rooms.join(`barber:${barberId}`, ws);

    // Heartbeat: terminate stale connections
    let isAlive = true;
    const heartbeat = setInterval(() => {
      if (!isAlive) {
        ws.terminate();
        return;
      }
      isAlive = false;
      ws.ping();
      // Give the client PONG_TIMEOUT_MS to respond before marking as dead
      setTimeout(() => {
        if (!isAlive) ws.terminate();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);

    ws.on('pong', () => { isAlive = true; });

    ws.on('close', () => {
      clearInterval(heartbeat);
      rooms.leaveAll(ws);
    });

    ws.on('error', (err) => {
      console.error(`WS error for barber ${barberId}:`, err);
    });
  });

  // Wire event bus → WebSocket broadcasts
  eventBus.on('booking.created', ({ shopId, barberId, booking }) => {
    rooms.broadcast(`barber:${barberId}`, { type: 'BOOKING_CREATED', payload: booking });
    rooms.broadcast(`shop:${shopId}`, { type: 'BOOKING_CREATED', payload: booking });
  });

  return wss;
}
