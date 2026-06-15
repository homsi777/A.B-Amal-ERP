import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { useAnchoredPopoverStyle } from '../lib/useAnchoredPopoverStyle';

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
  const [mobileExpandedKey, setMobileExpandedKey] = useState<string | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const notifyRef = useRef<HTMLDivElement>(null);

  const customerOrders = useStore((s) => s.customerOrders);
  const customers = useStore((s) => s.customers);

  const pickupAlerts = useMemo(() => selectNearPickupOrders(customerOrders), [customerOrders]);
  const notifyPanelStyle = useAnchoredPopoverStyle(notifyRef, notifyOpen);
  const hasAlerts = pickupAlerts.length > 0;

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

  useEffect(() => {
    if (!mobileMenuOpen) {
      setMobileExpandedKey(null);
      return;
    }
    const activeGroup = navItems.find(
      (item) => 'subItems' in item && item.subItems?.some((sub) => isRouteActive(sub.to)),
    );
    if (activeGroup && 'labelKey' in activeGroup) {
      setMobileExpandedKey(activeGroup.labelKey);
    }
  }, [mobileMenuOpen, location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  const renderNotificationBell = (buttonClassName = 'relative rounded-xl p-2.5 transition border') => (
    <div ref={notifyRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setNotifyOpen((v) => !v)}
        className={`${buttonClassName} ${
          notifyOpen
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] hover:text-[var(--text-heading)] hover:border-[var(--border-default)]'
        } ${hasAlerts && !notifyOpen ? 'notify-bell-glow bg-amber-50/80 text-amber-700 border-amber-200/80' : ''}`}
        title={t('notifications.title')}
        aria-expanded={notifyOpen}
        aria-haspopup="true"
      >
        <Bell className={`w-5 h-5 ${hasAlerts ? 'text-amber-600' : ''}`} strokeWidth={2} />
        {hasAlerts && (
          <span className="notify-badge-pulse absolute -top-0.5 -start-0.5 min-w-[18px] h-[18px] px-0.5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-[9px] font-bold text-white flex items-center justify-center shadow-md ring-2 ring-white md:min-w-[20px] md:h-5 md:px-1 md:text-[10px]">
            {pickupAlerts.length > 99 ? '99+' : pickupAlerts.length}
          </span>
        )}
      </button>
      {notifyOpen && notifyPanelStyle && createPortal(
        <div
          style={notifyPanelStyle}
          className={`rounded-2xl border border-amber-200/80 bg-[var(--surface-header)] overflow-hidden ${hasAlerts ? 'notify-panel-glow' : 'shadow-2xl ring-1 ring-black/5'}`}
          role="dialog"
          aria-label={t('notifications.title')}
        >
          <div className="px-4 py-3.5 border-b border-amber-100 bg-gradient-to-l from-amber-50 via-[var(--surface-muted-nav)] to-[var(--surface-header)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-black text-[var(--text-heading)]">{t('notifications.pickupTitle')}</p>
              {hasAlerts && (
                <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {pickupAlerts.length}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
              {t('notifications.pickupSubtitle')}
            </p>
          </div>
          <div className="max-h-[min(22rem,55vh)] overflow-y-auto custom-scrollbar">
            {!hasAlerts ? (
              <p className="px-4 py-8 text-sm text-center text-[var(--text-muted)]">لا توجد تنبيهات حالياً</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] p-2 space-y-1">
                {pickupAlerts.slice(0, 12).map((o) => {
                  const c = customers.find((x) => x.id === o.customerId);
                  return (
                    <li key={o.id}>
                      <Link
                        to="/orders"
                        className="block rounded-xl border border-transparent px-3 py-3 hover:border-amber-200/80 hover:bg-amber-50/60 transition text-right"
                        onClick={() => setNotifyOpen(false)}
                      >
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="font-mono font-bold text-[var(--ui-accent)] text-sm truncate">
                              {o.orderNumber}
                            </span>
                            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200/80">
                              {ORDER_STATUS_LABELS[o.status]}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-[var(--text-heading)] truncate">{c?.name ?? 'عميل'}</p>
                          {o.expectedDate && (
                            <p className="text-[11px] text-[var(--text-muted)]">
                              متوقع التوريد: {format(new Date(o.expectedDate), 'PP', { locale: ar })}
                            </p>
                          )}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {hasAlerts && (
            <div className="px-3 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-muted-nav)]">
              <Link
                to="/orders"
                className="block text-center text-xs font-bold text-[var(--ui-accent)] hover:underline py-1.5 rounded-lg hover:bg-[var(--ui-accent-soft-bg)]"
                onClick={() => setNotifyOpen(false)}
              >
                {t('notifications.openOrders')}
              </Link>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );

  return (
    <header className="bg-[var(--surface-header)] border-b border-[var(--border-default)] shadow-sm sticky top-0 z-50 transition-colors duration-300 [--mobile-nav-top:3.75rem] md:[--mobile-nav-top:4.5rem]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-subtle)] relative z-20 bg-[var(--surface-header)] md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-3 md:px-6 md:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:order-2 md:justify-center md:gap-3">
          <button
            type="button"
            className="p-2 lg:hidden text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] rounded-lg transition shrink-0"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? t('closeMenu', { ns: 'nav', defaultValue: 'إغلاق القائمة' }) : t('openMenu', { ns: 'nav', defaultValue: 'فتح القائمة' })}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <Link
            to="/"
            onClick={() => setMobileMenuOpen(false)}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 md:flex-none md:gap-3 rounded-xl transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]"
            aria-label={t('home', { ns: 'nav', defaultValue: 'الصفحة الرئيسية' })}
          >
            <div className="grid h-10 w-10 md:h-12 md:w-12 place-items-center rounded-xl bg-white ring-1 ring-[var(--border-default)] shadow-sm transition-colors duration-300 shrink-0">
              <img
                src={BRAND.logoPng}
                alt=""
                className="h-8 w-8 md:h-9 md:w-9 object-contain"
                draggable={false}
              />
            </div>
            <div className="leading-tight min-w-0 text-center md:text-start">
              <h1 className="text-lg md:text-2xl font-bold tracking-wider text-[var(--text-heading)] truncate">
                {BRAND.name}
              </h1>
              <span className="text-[9px] md:text-[10px] font-medium uppercase tracking-[0.18em] md:tracking-[0.22em] text-[var(--text-muted)]">
                {BRAND.tagline}
              </span>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-2 shrink-0 md:order-1 md:justify-self-start md:gap-3">
          <LanguageSwitcher />
          {renderNotificationBell('relative rounded-xl p-2 md:p-2.5 transition border')}
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
        <>
          <button
            type="button"
            aria-label={t('closeMenu', { ns: 'nav', defaultValue: 'إغلاق القائمة' })}
            className="lg:hidden fixed inset-0 top-[var(--mobile-nav-top,4.5rem)] z-40 bg-black/30 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <nav className="lg:hidden fixed inset-x-0 top-[var(--mobile-nav-top,4.5rem)] z-50 max-h-[calc(100dvh-var(--mobile-nav-top,4.5rem))] overflow-y-auto overscroll-contain border-b border-[var(--border-default)] bg-[var(--surface-header)] shadow-xl">
            <div className="divide-y divide-[var(--border-subtle)]">
              {navItems.map((item, idx) => {
                const parentActive = isParentActive(item);

                if ('subItems' in item && item.subItems) {
                  const expanded = mobileExpandedKey === item.labelKey;
                  return (
                    <div key={idx}>
                      <button
                        type="button"
                        onClick={() =>
                          setMobileExpandedKey((prev) => (prev === item.labelKey ? null : item.labelKey))
                        }
                        className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-right transition-colors ${
                          parentActive
                            ? 'bg-[var(--ui-nav-active-bg)] text-[var(--ui-nav-active-text)]'
                            : 'text-[var(--text-heading)] hover:bg-[var(--border-subtle)]'
                        }`}
                      >
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition-transform ${
                            expanded ? 'rotate-180' : ''
                          } ${parentActive ? 'text-[var(--ui-nav-active-icon)]' : 'text-[var(--text-muted)]'}`}
                        />
                        <span className="flex min-w-0 flex-1 items-center justify-end gap-2.5 font-semibold text-sm">
                          <span className="truncate">{t(item.labelKey, { ns: 'nav' })}</span>
                          <item.icon
                            className={`h-[18px] w-[18px] shrink-0 ${
                              parentActive ? 'text-[var(--ui-nav-active-icon)]' : 'text-[var(--ui-accent-muted)]'
                            }`}
                            strokeWidth={2}
                          />
                        </span>
                      </button>
                      {expanded && (
                        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-muted-nav)] py-1">
                          {item.subItems.map((sub, sIdx) => {
                            const isActive = isRouteActive(sub.to);
                            return (
                              <Link
                                key={sIdx}
                                to={sub.to}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`block px-4 py-2.5 text-sm text-right transition-colors border-s-2 ${
                                  isActive
                                    ? 'border-[var(--ui-mobile-accent-border)] bg-[var(--ui-accent-soft-bg)] font-bold text-[var(--ui-accent)]'
                                    : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--border-subtle)]'
                                }`}
                              >
                                {t(sub.labelKey, { ns: 'nav' })}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                if (!('to' in item)) return null;

                return (
                  <Link
                    key={idx}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-end gap-2.5 px-4 py-3 text-sm font-semibold transition-colors ${
                      parentActive
                        ? 'bg-[var(--ui-nav-active-bg)] text-[var(--ui-nav-active-text)]'
                        : 'text-[var(--text-heading)] hover:bg-[var(--border-subtle)]'
                    }`}
                  >
                    <span>{t(item.labelKey, { ns: 'nav' })}</span>
                    <item.icon
                      className={`h-[18px] w-[18px] shrink-0 ${
                        parentActive ? 'text-[var(--ui-nav-active-icon)]' : 'text-[var(--ui-accent-muted)]'
                      }`}
                      strokeWidth={2}
                    />
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      )}
    </header>
  );
};

export const DashboardLayout = () => {
  const location = useLocation();
  const isReports = location.pathname === '/reports' || location.pathname.startsWith('/reports/');
  const mainClass = isReports
    ? 'flex-1 p-0 overflow-y-auto w-full max-w-none'
    : 'flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto w-full max-w-[1600px] mx-auto';
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
