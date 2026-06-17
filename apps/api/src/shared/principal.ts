/**
 * The authenticated staff actor resolved by requireStaff — either a shop owner
 * (session) or a barber (JWT). Always scoped to a single shop (shopId === req.shop.id,
 * enforced fail-closed in requireStaff).
 */
export interface StaffPrincipal {
  kind: 'owner' | 'barber';
  id: string;
  shopId: string;
  name: string;
}
