import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  FileText,
  Layers,
  Package,
  PlusCircle,
  RefreshCw,
  Settings,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { getDashboardSummary, type DashboardSummary } from '../lib/api/reportsApi';

const defaultLinkIds = ['create_item', 'inventory', 'warehouses', 'sales', 'purchases', 'bonds_in', 'bonds_out'];

const quickLinkDefs = [
  { id: 'create_item', labelKey: 'quickLinks.createItem', path: '/inventory/create', icon: PlusCircle, color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
  { id: 'inventory', labelKey: 'quickLinks.rolls', path: '/inventory', icon: Package, color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
  { id: 'warehouses', labelKey: 'quickLinks.warehouses', path: '/inventory/warehouses', icon: Layers, color: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100' },
  { id: 'sales', labelKey: 'quickLinks.salesInvoice', path: '/invoices/sales', icon: ShoppingCart, color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
  { id: 'purchases', labelKey: 'quickLinks.purchaseInvoice', path: '/invoices/purchases', icon: FileText, color: 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100' },
  { id: 'bonds_in', labelKey: 'quickLinks.receiptVoucher', path: '/bonds/collection', icon: ArrowDownToLine, color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
  { id: 'bonds_out', labelKey: 'quickLinks.paymentVoucher', path: '/bonds/payment', icon: ArrowUpFromLine, color: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' },
  { id: 'customers', labelKey: 'quickLinks.customers', path: '/customers', icon: Users, color: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100' },
  { id: 'suppliers', labelKey: 'quickLinks.suppliers', path: '/suppliers', icon: TrendingUp, color: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' },
  { id: 'safes', labelKey: 'quickLinks.safes', path: '/treasury/safes', icon: Wallet, color: 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100' },
];

function numberValue(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(value: unknown, locale: string, digits = 0): string {
  return numberValue(value).toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtMoney(value: unknown, locale: string, currency = 'USD'): string {
  return `${fmtNumber(value, locale, 2)} ${currency}`;
}

export const Dashboard = () => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const numberLocale = i18n.language === 'tr' ? 'tr-TR' : 'ar-SY';

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLinkIds, setSelectedLinkIds] = useState<string[]>(defaultLinkIds);
  const [tempSelected, setTempSelected] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDashboardSummary();
      setSummary(res.data);
    } catch (e) {
      setSummary(null);
      setError(e instanceof Error ? e.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem('erp_quick_links');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setSelectedLinkIds(parsed);
      } catch {
        setSelectedLinkIds(defaultLinkIds);
      }
    }
    void loadSummary();
  }, []);

  const activeLinks = quickLinkDefs.filter((link) => selectedLinkIds.includes(link.id));

  const cards = useMemo(() => {
    const d = summary;
    return [
      { key: 'cards.customers', value: fmtNumber(d?.customers_count, numberLocale), icon: Users, bg: 'bg-indigo-50', color: 'text-indigo-700' },
      { key: 'cards.suppliers', value: fmtNumber(d?.suppliers_count, numberLocale), icon: TrendingUp, bg: 'bg-orange-50', color: 'text-orange-700' },
      { key: 'cards.totalRolls', value: fmtNumber(d?.fabric_rolls_count, numberLocale), icon: Package, bg: 'bg-cyan-50', color: 'text-cyan-700' },
      { key: 'cards.activeRolls', value: fmtNumber(d?.active_fabric_rolls_count, numberLocale), icon: Package, bg: 'bg-emerald-50', color: 'text-emerald-700' },
      { key: 'cards.totalMeters', value: fmtNumber(d?.total_roll_length_m, numberLocale, 2), icon: Layers, bg: 'bg-blue-50', color: 'text-blue-700' },
      { key: 'cards.totalWeightKg', value: fmtNumber(d?.total_roll_weight_kg, numberLocale, 2), icon: Layers, bg: 'bg-slate-50', color: 'text-slate-700' },
      { key: 'cards.receiptVouchers', value: fmtMoney(d?.receipt_total, numberLocale), icon: ArrowDownToLine, bg: 'bg-green-50', color: 'text-green-700' },
      { key: 'cards.paymentVouchers', value: fmtMoney(d?.payment_total, numberLocale), icon: ArrowUpFromLine, bg: 'bg-rose-50', color: 'text-rose-700' },
    ];
  }, [summary, numberLocale]);

  const operations = useMemo(
    () => [
      { key: 'operations.warehouses', value: fmtNumber(summary?.warehouses_count, numberLocale), path: '/inventory/warehouses' },
      { key: 'operations.importBatches', value: fmtNumber(summary?.purchase_import_batches_count, numberLocale), path: '/purchases/import-batches' },
      { key: 'operations.inventoryMovements', value: fmtNumber(summary?.inventory_movements_count, numberLocale), path: '/reports' },
      { key: 'operations.vouchers', value: fmtNumber(summary?.vouchers_count, numberLocale), path: '/bonds/records' },
      { key: 'operations.returns', value: fmtNumber(summary?.return_invoices_count, numberLocale), path: '/invoices/returns' },
      { key: 'operations.transfers', value: fmtNumber(summary?.transfers_count, numberLocale), path: '/inventory/transfers' },
    ],
    [summary, numberLocale],
  );

  const cashRows = summary?.total_cash_by_currency ?? [];
  const damagedRolls = numberValue(summary?.damaged_or_waste_rolls_count);

  const handleSaveSettings = () => {
    setSelectedLinkIds(tempSelected);
    localStorage.setItem('erp_quick_links', JSON.stringify(tempSelected));
    setIsSettingsOpen(false);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-950">{t('title')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          <AlertTriangle className="h-5 w-5" />
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black text-slate-900">{t('quickAccess')}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
              {t('shortcutsCount', { count: activeLinks.length })}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setTempSelected(selectedLinkIds);
              setIsSettingsOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
          >
            <Settings className="h-4 w-4" />
            {t('customize')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {activeLinks.map((link) => (
            <Link key={link.id} to={link.path} className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center shadow-sm transition ${link.color}`}>
              <link.icon className="h-6 w-6" />
              <span className="text-sm font-black">{t(link.labelKey)}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.key} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className={`rounded-2xl p-4 ${card.bg}`}>
              <card.icon className={`h-6 w-6 ${card.color}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">{t(card.key)}</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{loading ? '...' : card.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 text-lg font-black text-slate-900">{t('operationalIndicators')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {operations.map((item) => (
              <Link key={item.key} to={item.path} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 transition hover:border-indigo-200 hover:bg-indigo-50">
                <span className="font-bold text-slate-700">{t(item.key)}</span>
                <span className="font-mono text-lg font-black text-slate-950">{loading ? '...' : item.value}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-lg font-black text-slate-900">{t('cashboxBalances')}</h3>
            {cashRows.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-4 text-center text-sm font-bold text-slate-500">{t('noActiveCashboxes')}</div>
            ) : (
              <div className="space-y-2">
                {cashRows.map((row) => (
                  <div key={row.currency_code} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="font-black text-slate-700">{row.currency_code}</span>
                    <span className="font-mono text-lg font-black text-emerald-700">{fmtMoney(row.total, numberLocale, row.currency_code)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`rounded-2xl border p-5 shadow-sm ${damagedRolls > 0 ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className="flex items-center gap-3">
              <AlertTriangle className={`h-6 w-6 ${damagedRolls > 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
              <div>
                <p className="text-sm font-bold text-slate-600">{t('damagedRolls')}</p>
                <p className={`text-2xl font-black ${damagedRolls > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{loading ? '...' : fmtNumber(damagedRolls, numberLocale)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-4">
              <h3 className="flex items-center gap-2 text-lg font-black text-slate-800">
                <Settings className="h-5 w-5 text-indigo-600" />
                {t('customizeTitle')}
              </h3>
              <button type="button" onClick={() => setIsSettingsOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
              {quickLinkDefs.map((link) => {
                const selected = tempSelected.includes(link.id);
                return (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => setTempSelected((prev) => (prev.includes(link.id) ? prev.filter((id) => id !== link.id) : [...prev, link.id]))}
                    className={`flex items-center justify-between rounded-xl border p-3 text-start transition ${
                      selected ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-3 font-black">
                      <link.icon className="h-5 w-5" />
                      {t(link.labelKey)}
                    </span>
                    {selected && <Check className="h-5 w-5 text-indigo-600" />}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-4">
              <button type="button" onClick={() => setIsSettingsOpen(false)} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-white">
                {t('cancel', { ns: 'common' })}
              </button>
              <button type="button" onClick={handleSaveSettings} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-black text-white hover:bg-indigo-700">
                {t('save', { ns: 'common' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
