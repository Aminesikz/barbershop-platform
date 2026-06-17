import { EventEmitter } from 'node:events';
import type { BookingBroadcastDTO } from '@barber/shared-types';

export interface BookingCreatedEvent {
  shopId: string;
  barberId: string;
  // SECURITY: redacted broadcast shape — compiler-enforced to omit customer phone/PII.
  booking: BookingBroadcastDTO;
}

interface EventMap {
  'booking.created': [BookingCreatedEvent];
}

class TypedEventBus extends EventEmitter {
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export const eventBus = new TypedEventBus();
