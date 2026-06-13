import type { AuthUser } from '../api/authApi';

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return user?.role === 'admin';
}

export function hasPermission(user: AuthUser | null | undefined, code: string): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return user.permissions.includes(code);
}

export function hasAnyPermission(user: AuthUser | null | undefined, codes: string[]): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return codes.some((code) => user.permissions.includes(code));
}

export function canAccessDelivery(user: AuthUser | null | undefined): boolean {
  return hasAnyPermission(user, ['delivery.tafnid', 'delivery.fulfill']);
}

/** مستخدم مخزون/تسليم فقط — بدون صلاحيات تشغيلية أخرى */
export function isDeliveryOnlyUser(user: AuthUser | null | undefined): boolean {
  if (!user || isAdmin(user)) return false;
  if (!canAccessDelivery(user)) return false;
  const other = user.permissions.filter(
    (p) => !p.startsWith('delivery.') && p !== 'dashboard.view',
  );
  return other.length === 0;
}

export function getDefaultLandingPath(user: AuthUser | null | undefined): string {
  if (isDeliveryOnlyUser(user) || (canAccessDelivery(user) && !hasPermission(user, 'dashboard.view'))) {
    return '/delivery';
  }
  return '/';
}

const PATH_RULES: { prefix: string; permissions: string[] }[] = [
  { prefix: '/delivery', permissions: ['delivery.tafnid', 'delivery.fulfill'] },
  { prefix: '/inventory', permissions: ['inventory.view', 'inventory.manage'] },
  { prefix: '/invoices/sales', permissions: ['purchases.view', 'purchases.manage'] },
  { prefix: '/invoices/purchases', permissions: ['purchases.view', 'purchases.manage'] },
  { prefix: '/invoices', permissions: ['purchases.view', 'purchases.manage'] },
  { prefix: '/purchases', permissions: ['purchases.view', 'purchases.manage'] },
  { prefix: '/customers', permissions: ['customers.view', 'customers.manage'] },
  { prefix: '/suppliers', permissions: ['suppliers.view', 'suppliers.manage'] },
  { prefix: '/orders', permissions: ['customers.view', 'customers.manage'] },
  { prefix: '/reports', permissions: ['reports.view'] },
  { prefix: '/settings', permissions: ['settings.view', 'settings.manage', 'users.manage'] },
  { prefix: '/treasury', permissions: ['settings.view', 'settings.manage'] },
  { prefix: '/bonds', permissions: ['settings.view', 'settings.manage'] },
  { prefix: '/expenses', permissions: ['settings.view', 'settings.manage'] },
  { prefix: '/salaries', permissions: ['settings.view', 'settings.manage'] },
  { prefix: '/chart-of-accounts', permissions: ['settings.view', 'settings.manage'] },
  { prefix: '/journal', permissions: ['settings.view', 'settings.manage'] },
  { prefix: '/manufacturing', permissions: ['settings.view', 'settings.manage'] },
  { prefix: '/partners', permissions: ['settings.view', 'settings.manage'] },
];

export function canAccessPath(user: AuthUser | null | undefined, pathname: string): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (pathname === '/' || pathname === '') {
    if (isDeliveryOnlyUser(user)) return false;
    return hasPermission(user, 'dashboard.view');
  }
  if (pathname === '/login') return true;

  const rule = PATH_RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!rule) return true;
  return hasAnyPermission(user, rule.permissions);
}

export type NavPermissionSpec =
  | { anyOf: string[] }
  | { allOf: string[] }
  | null;

export const NAV_PERMISSIONS: Record<string, NavPermissionSpec> = {
  home: { anyOf: ['dashboard.view'] },
  inventory: { anyOf: ['inventory.view', 'inventory.manage'] },
  invoices: { anyOf: ['purchases.view', 'purchases.manage'] },
  orders: { anyOf: ['customers.view', 'customers.manage'] },
  delivery: { anyOf: ['delivery.tafnid', 'delivery.fulfill'] },
  parties: { anyOf: ['customers.view', 'customers.manage', 'suppliers.view', 'suppliers.manage'] },
  treasury: { anyOf: ['settings.view', 'settings.manage'] },
  bonds: { anyOf: ['settings.view', 'settings.manage'] },
  expenses: { anyOf: ['settings.view', 'settings.manage'] },
  salaries: { anyOf: ['settings.view', 'settings.manage'] },
  reports: { anyOf: ['reports.view'] },
  chartOfAccounts: { anyOf: ['settings.view', 'settings.manage'] },
  journal: { anyOf: ['settings.view', 'settings.manage'] },
  manufacturing: { anyOf: ['settings.view', 'settings.manage'] },
  partners: { anyOf: ['settings.view', 'settings.manage'] },
  settings: { anyOf: ['settings.view', 'settings.manage', 'users.manage'] },
};

export function canSeeNavItem(user: AuthUser | null | undefined, key: string): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const spec = NAV_PERMISSIONS[key];
  if (!spec) return true;
  if ('anyOf' in spec) return hasAnyPermission(user, spec.anyOf);
  return spec.allOf.every((p) => hasPermission(user, p));
}
