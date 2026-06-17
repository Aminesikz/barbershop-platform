import type { StaffPrincipal } from './principal.js';
import { forbidden } from './httpError.js';

/**
 * Authorize a staff actor to manage a specific barber's schedule/time-off.
 * - Owner: may manage any barber in the shop (shop membership is enforced by the
 *   DB composite FK / WHERE shop_id in the service layer).
 * - Barber: may manage ONLY themselves.
 *
 * Throws 403 otherwise. Call BEFORE any mutation (authorize-before-write).
 */
export function assertCanManageBarber(staff: StaffPrincipal, barberId: string): void {
  if (staff.kind === 'owner') return;
  if (staff.id !== barberId) {
    throw forbidden('Cannot manage another barber');
  }
}
