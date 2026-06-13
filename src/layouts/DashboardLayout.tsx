import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  BookOpen,
  Briefcase,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Factory,
  FileText,
  Handshake,
  Home,
  Menu,
  Network,
  Package,
  PieChart,
  Receipt,
  Settings,
  Truck,
  Users,
  Wallet,
  X,
  Bell,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useStore } from '../store/useStore';
import type { CustomerOrder } from '../types';
import { ORDER_STATUS_LABELS } from '../pages/orders/orderStatusUi';
import { useTranslation } from 'react-i18next';
import { BackendConnectionBadge } from '../components/BackendConnectionBadge';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ToastProvider } from '../components/NonBlockingToast';
import { BRAND } from '../branding';
import { countPendingDeliveryApprovals } from '../lib/api/deliveryApi';
import { AR_WHOLESALE } from '../lib/i18n/arTerminology';

/** أيام حتى موعد التوريد المتوقع (تاريخ محلي) */
function daysUntilSupply(expectedDate: string): number {
  const target = new Date(`${expectedDate}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function selectNearPickupOrders(orders: CustomerOrder[]): CustomerOrder[] {
  return orders.filter((o) => {
    if (o.status === 'ready_pickup') return true;
    if (!o.expectedDate) return false;
    const days = daysUntilSupply(o.expectedDate);
    if (days < 0 || days > 7) return false;
    return o.status === 'pending_supply' || o.status === 'partial_ready';
  });
}

type NavSubItem = { labelKey: string; to: string };
type NavItem =
  | { labelKey: string; to: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }
  | {
      labelKey: string;
      icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
      subItems: NavSubItem[];
    };

const Topbar = () => {
  const { t } = useTranslation(['nav', 'common']);
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const notifyRef = useRef<HTMLDivElement>(null);

  const customerOrders = useStore((s) => s.customerOrders);
  const customers = useStore((s) => s.customers);

  const pickupAlerts = useMemo(() => selectNearPickupOrders(customerOrders), [customerOrders]);
  const [deliveryPendingCount, setDeliveryPendingCount] = useState(0);
  const notifyTotal = pickupAlerts.length + deliveryPendingCount;

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void countPendingDeliveryApprovals()
        .then((n) => {
          if (!cancelled) setDeliveryPendingCount(n);
        })
        .catch(() => {
          if (!cancelled) setDeliveryPendingCount(0);
        });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!notifyOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (notifyRef.current && !notifyRef.current.contains(e.target as Node)) setNotifyOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [notifyOpen]);

  const navItems: NavItem[] = [
    { labelKey: 'home', to: '/', icon: Home },
    {
      labelKey: 'inventory',
      icon: Package,
      subItems: [
        { labelKey: 'inventory.createItem', to: '/inventory/create' },
        { labelKey: 'inventory.rolls', to: '/inventory' },
        { labelKey: 'inventory.categories', to: '/inventory/categories' },
        { labelKey: 'inventory.labels', to: '/inventory/labels' },
        { labelKey: 'inventory.customLabel', to: '/inventory/custom-label' },
        { labelKey: 'inventory.printJobs', to: '/inventory/print-jobs' },
        { labelKey: 'inventory.settings', to: '/inventory/settings' },
        { labelKey: 'inventory.bulkPricing', to: '/inventory/bulk-pricing' },
        { labelKey: 'inventory.warehouses', to: '/inventory/warehouses' },
        { labelKey: 'inventory.transfers', to: '/inventory/transfers' },
        { labelKey: 'inventory.depreciation', to: '/inventory/depreciation' },
      ],
    },
    {
      labelKey: 'invoices',
      icon: FileText,
      subItems: [
        { labelKey: 'invoices.sales', to: '/invoices/sales' },
        { labelKey: 'invoices.purchases', to: '/invoices/purchases' },
        { labelKey: 'invoices.exchange', to: '/invoices/exchange' },
        { labelKey: 'invoices.returns', to: '/invoices/returns' },
        { labelKey: 'invoices.statement', to: '/invoices/statement' },
      ],
    },
    { labelKey: 'orders', to: '/orders', icon: ClipboardList },
    { labelKey: 'delivery', to: '/delivery', icon: Truck },
    {
      labelKey: 'parties',
      icon: Users,
      subItems: [
        { labelKey: 'parties.customers', to: '/customers' },
        { labelKey: 'parties.suppliers', to: '/suppliers' },
        { labelKey: 'parties.customersLog', to: '/customers/log' },
        { labelKey: 'parties.suppliersLog', to: '/suppliers/log' },
        { labelKey: 'parties.customerStatement', to: '/customers/statement' },
        { labelKey: 'parties.supplierStatement', to: '/suppliers/statement' },
      ],
    },
    {
      labelKey: 'treasury',
      icon: Wallet,
      subItems: [
        { labelKey: 'treasury.safes', to: '/treasury/safes' },
        { labelKey: 'treasury.log', to: '/treasury/log' },
        { labelKey: 'treasury.profitDetails', to: '/treasury/profit-details' },
        { labelKey: 'treasury.settings', to: '/treasury/settings' },
      ],
    },
    {
      labelKey: 'bonds',
      icon: Receipt,
      subItems: [
        { labelKey: 'bonds.payment', to: '/bonds/payment' },
        { labelKey: 'bonds.collection', to: '/bonds/collection' },
        { labelKey: 'bonds.records', to: '/bonds/records' },
      ],
    },
    { labelKey: 'expenses', to: '/expenses', icon: CreditCard },
    { labelKey: 'salaries', to: '/salaries', icon: Briefcase },
    { labelKey: 'reports', to: '/reports', icon: PieChart },
    { labelKey: 'chartOfAccounts', to: '/chart-of-accounts', icon: Network },
    { labelKey: 'journal', to: '/journal', icon: BookOpen },
    { labelKey: 'manufacturing', to: '/manufacturing', icon: Factory },
    { labelKey: 'partners', to: '/partners', icon: Handshake },
    { labelKey: 'settings', to: '/settings', icon: Settings },
  ];

  const isRouteActive = (to?: string) => {
    if (!to) return false;
    if (to === '/') return location.pathname === '/';
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  };

  const isParentActive = (item: NavItem) => {
    if ('subItems' in item && item.subItems) {
      return item.subItems.some((sub) => isRouteActive(sub.to));
    }
    if ('to' in item) return isRouteActive(item.to);
    return false;
  };

  const parentBtn = (parentActive: boolean) =>
    `flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors font-medium text-sm border ${
      parentActive
        ? 'bg-[var(--ui-nav-active-bg)] text-[var(--ui-nav-active-text)] border-[var(--ui-nav-active-border)] shadow-sm'
        : 'text-[var(--text-muted)] border-transparent hover:bg-[var(--border-subtle)] hover:text-[var(--text-heading)]'
    }`;

  const parentIcon = (parentActive: boolean) =>
    parentActive ? 'text-[var(--ui-nav-active-icon)]' : '';

  const chevronCls = (parentActive: boolean) =>
    `w-3 h-3 transition-transform group-hover:rotate-180 ${
      parentActive ? 'text-[var(--ui-accent-muted)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-heading)]'
    }`;

  const linkTopCls = (parentActive: boolean) =>
    `flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-lg transition-colors font-medium text-sm border ${
      parentActive
        ? 'bg-[var(--ui-nav-active-bg)] text-[var(--ui-nav-active-text)] border-[var(--ui-nav-active-border)] shadow-sm'
        : 'text-[var(--text-muted)] border-transparent hover:bg-[var(--border-subtle)] hover:text-[var(--text-heading)]'
    }`;

  const subLinkCls = (isActive: boolean) =>
    `px-4 py-2 text-sm text-right transition-colors ${
      isActive
        ? 'bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)] font-medium'
        : 'text-[var(--text-muted)] hover:bg-[var(--ui-dropdown-hover-bg)] hover:text-[var(--ui-accent-hover)]'
    }`;

  return (
    <header className="bg-[var(--surface-header)] border-b border-[var(--border-default)] shadow-sm sticky top-0 z-50 transition-colors duration-300">
      <div className="grid grid-cols-1 gap-3 px-6 py-3 border-b border-[var(--border-subtle)] relative z-20 bg-[var(--surface-header)] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        <div className="order-1 flex items-center justify-center md:order-2">
          <div
            className="rounded-xl px-3 py-1.5 shadow-sm ring-1 ring-black/10"
            style={{ backgroundColor: BRAND.logoBg }}
          >
            <img
              src={BRAND.logoPng}
              alt={BRAND.name}
              className="h-12 w-auto max-w-[11rem] object-contain"
              draggable={false}
            />
          </div>
        </div>
        <div className="order-2 flex items-center justify-center gap-3 md:order-1 md:justify-self-start">
          <LanguageSwitcher />
          <div ref={notifyRef} className="relative">
            <button
              type="button"
              onClick={() => setNotifyOpen((v) => !v)}
              className="relative p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] hover:text-[var(--text-heading)] transition border border-transparent hover:border-[var(--border-default)]"
              title={t('notifications.title')}
              aria-expanded={notifyOpen}
              aria-haspopup="true"
            >
              <Bell className="w-5 h-5" strokeWidth={2} />
              {notifyTotal > 0 && (
                <span className="absolute top-1 end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[10px] font-bold text-white flex items-center justify-center shadow-sm">
                  {notifyTotal > 99 ? '99+' : notifyTotal}
                </span>
              )}
            </button>
            {notifyOpen && (
              <div className="absolute end-0 mt-2 w-[min(100vw-2rem,22rem)] rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-xl z-[120] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-muted-nav)]">
                  <p className="text-sm font-bold text-[var(--text-heading)]">{t('notifications.pickupTitle')}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {t('notifications.pickupSubtitle')}
                  </p>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {pickupAlerts.length === 0 && deliveryPendingCount === 0 ? (
                    <p className="px-4 py-6 text-sm text-center text-[var(--text-muted)]">لا توجد تنبيهات حالياً</p>
                  ) : (
                    <ul className="divide-y divide-[var(--border-subtle)]">
                      {deliveryPendingCount > 0 ? (
                        <li>
                          <Link
                            to="/delivery"
                            className="block px-4 py-3 hover:bg-[var(--border-subtle)] transition text-right"
                            onClick={() => setNotifyOpen(false)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-[var(--ui-accent)] text-sm">تسليم الجملة</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 whitespace-nowrap">
                                {deliveryPendingCount}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--text-heading)] mt-1">{AR_WHOLESALE.tafnidSaved}</p>
                          </Link>
                        </li>
                      ) : null}
                      {pickupAlerts.slice(0, 12).map((o) => {
                        const c = customers.find((x) => x.id === o.customerId);
                        return (
                          <li key={o.id}>
                            <Link
                              to="/orders"
                              className="block px-4 py-3 hover:bg-[var(--border-subtle)] transition text-right"
                              onClick={() => setNotifyOpen(false)}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-mono font-semibold text-[var(--ui-accent)] text-sm">{o.orderNumber}</span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 whitespace-nowrap">
                                  {ORDER_STATUS_LABELS[o.status]}
                                </span>
                              </div>
                              <p className="text-xs text-[var(--text-heading)] mt-1">{c?.name ?? 'عميل'}</p>
                              {o.expectedDate && (
                                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                                  متوقع التوريد: {format(new Date(o.expectedDate), 'PP', { locale: ar })}
                                </p>
                              )}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {(pickupAlerts.length > 0 || deliveryPendingCount > 0) && (
                  <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--surface-muted-nav)]">
                    {deliveryPendingCount > 0 ? (
                      <Link
                        to="/delivery"
                        className="block text-center text-xs font-bold text-[var(--ui-accent)] hover:underline py-1"
                        onClick={() => setNotifyOpen(false)}
                      >
                        فتح قسم التسليم
                      </Link>
                    ) : null}
                    {pickupAlerts.length > 0 ? (
                      <Link
                        to="/orders"
                        className="block text-center text-xs font-bold text-[var(--ui-accent)] hover:underline py-1"
                        onClick={() => setNotifyOpen(false)}
                      >
                        {t('notifications.openOrders')}
                      </Link>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
          <Link
            to="/login"
            className="hidden md:inline text-xs font-bold text-[var(--ui-accent)] hover:underline px-1"
          >
            {t('apiLogin')}
          </Link>
          <BackendConnectionBadge />
          <div className="hidden sm:flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--ui-accent-soft-bg)] flex items-center justify-center text-[var(--ui-accent)] font-bold border border-[var(--ui-accent-border)]">
              M
            </div>
            <div className="text-sm">
              <p className="font-medium text-[var(--text-heading)]">{t('systemAdmin')}</p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 lg:hidden text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] rounded-lg transition"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
        <div className="hidden md:block md:order-3" aria-hidden="true" />
      </div>

      <nav className="px-6 py-2 hidden lg:flex flex-wrap gap-1 items-center bg-[var(--surface-muted-nav)] relative z-10 w-full transition-colors duration-300">
        {navItems.map((item, idx) => {
          const parentActive = isParentActive(item);

          if ('subItems' in item && item.subItems) {
            return (
              <div key={idx} className="relative group shrink-0">
                <button type="button" className={parentBtn(parentActive)}>
                  <item.icon className={`w-4 h-4 ${parentIcon(parentActive)}`} strokeWidth={2} />
                  <span>{t(item.labelKey, { ns: 'nav' })}</span>
                  <ChevronDown className={chevronCls(parentActive)} />
                </button>
                <div className="absolute end-0 mt-1 w-56 bg-[var(--surface-header)] border border-[var(--border-default)] shadow-xl rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] flex flex-col py-1">
                  {item.subItems.map((sub, sIdx) => {
                    const isActive = isRouteActive(sub.to);
                    return (
                      <Link key={sIdx} to={sub.to} className={subLinkCls(isActive)}>
                        {t(sub.labelKey, { ns: 'nav' })}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }

          if (!('to' in item)) return null;

          return (
            <Link key={idx} to={item.to} className={linkTopCls(parentActive)}>
              <item.icon className={`w-4 h-4 ${parentIcon(parentActive)}`} strokeWidth={2} />
              <span>{t(item.labelKey, { ns: 'nav' })}</span>
            </Link>
          );
        })}
      </nav>

      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 right-0 bg-[var(--surface-header)] border-b border-[var(--border-default)] shadow-xl max-h-[80vh] overflow-y-auto flex flex-col p-4 gap-2 z-50">
          {navItems.map((item, idx) => {
            const parentActive = isParentActive(item);

            if ('subItems' in item && item.subItems) {
              return (
                <div
                  key={idx}
                  className={`flex flex-col border rounded-lg overflow-hidden ${
                    parentActive
                      ? 'border-[var(--ui-nav-active-border)] bg-[var(--ui-nav-active-bg)]'
                      : 'border-[var(--border-default)] bg-[var(--surface-mobile-shell)]'
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 px-4 py-3 font-bold ${
                      parentActive
                        ? 'text-[var(--ui-nav-active-text)] bg-[var(--ui-accent-soft-bg-strong)]'
                        : 'text-[var(--text-heading)] bg-[var(--border-subtle)]'
                    }`}
                  >
                    <item.icon
                      className={`w-5 h-5 ${parentActive ? 'text-[var(--ui-nav-active-icon)]' : 'text-[var(--ui-accent-muted)]'}`}
                      strokeWidth={2}
                    />
                    <span>{t(item.labelKey, { ns: 'nav' })}</span>
                  </div>
                  <div className="flex flex-col py-2 bg-[var(--surface-header)]">
                    {item.subItems.map((sub, sIdx) => {
                      const isActive = isRouteActive(sub.to);
                      return (
                        <Link
                          key={sIdx}
                          to={sub.to}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`px-10 py-2.5 text-sm transition-colors border-s-2 ${
                            isActive
                              ? `bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)] font-bold border-[var(--ui-mobile-accent-border)]`
                              : 'text-[var(--text-muted)] border-transparent hover:bg-[var(--border-subtle)]'
                          }`}
                        >
                          {t(sub.labelKey, { ns: 'nav' })}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (!('to' in item)) return null;

            return (
              <Link
                key={idx}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-colors font-bold border ${
                  parentActive
                    ? 'bg-[var(--ui-nav-active-bg)] text-[var(--ui-nav-active-text)] border-[var(--ui-nav-active-border)] shadow-sm'
                    : `bg-[var(--surface-mobile-shell)] text-[var(--text-heading)] hover:bg-[var(--border-subtle)] border-[var(--border-default)]`
                }`}
              >
                <item.icon className={`w-5 h-5 ${parentActive ? 'text-[var(--ui-nav-active-icon)]' : ''}`} strokeWidth={2} />
                <span>{t(item.labelKey, { ns: 'nav' })}</span>
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
};

export const DashboardLayout = () => {
  const location = useLocation();
  const isReports = location.pathname === '/reports' || location.pathname.startsWith('/reports/');
  const mainClass = isReports
    ? 'flex-1 p-0 overflow-y-auto w-full max-w-none'
    : 'flex-1 p-8 overflow-y-auto w-full max-w-[1600px] mx-auto';
  return (
    <div className="min-h-screen bg-[var(--page-bg)] flex flex-col transition-colors duration-300">
      <Topbar />
      <main className={mainClass}>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </main>
    </div>
  );
};
