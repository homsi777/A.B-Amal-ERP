import type { AuthUser } from './api/authApi';

export function canSaveDeliveryTafnid(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager' || user.role === 'inventory') return true;
  return user.permissions.includes('delivery.tafnid');
}

export function canFulfillDelivery(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  return user.permissions.includes('delivery.fulfill');
}
