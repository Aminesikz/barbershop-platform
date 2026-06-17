import { WebSocket } from 'ws';

const rooms = new Map<string, Set<WebSocket>>();

export function join(room: string, socket: WebSocket): void {
  let members = rooms.get(room);
  if (!members) {
    members = new Set();
    rooms.set(room, members);
  }
  members.add(socket);
}

export function leave(room: string, socket: WebSocket): void {
  const members = rooms.get(room);
  if (!members) return;
  members.delete(socket);
  if (members.size === 0) rooms.delete(room);
}

export function leaveAll(socket: WebSocket): void {
  for (const [room, members] of rooms) {
    members.delete(socket);
    if (members.size === 0) rooms.delete(room);
  }
}

export function broadcast(
  room: string,
  message: unknown,
  excludeSocket?: WebSocket,
): void {
  const members = rooms.get(room);
  if (!members) return;

  const payload = JSON.stringify(message);
  for (const socket of members) {
    if (socket === excludeSocket) continue;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}
