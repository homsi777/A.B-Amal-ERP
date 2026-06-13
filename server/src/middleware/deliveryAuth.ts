import type { JwtPayload } from './auth.js';

export function canSaveDeliveryTafnid(user: JwtPayload | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager' || user.role === 'inventory') return true;
  return user.permissions.includes('delivery.tafnid');
}

export function canFulfillDelivery(user: JwtPayload | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  return user.permissions.includes('delivery.fulfill');
}
