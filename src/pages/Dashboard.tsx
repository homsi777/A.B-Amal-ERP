import React, { useEffect, useMemo, useState } from 'react';
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

const quickLinks = [
  { id: 'create_item', label: 'إنشاء خامة', path: '/inventory/create', icon: PlusCircle, color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
  { id: 'inventory', label: 'الأتواب', path: '/inventory', icon: Package, color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
  { id: 'warehouses', label: 'المستودعات', path: '/inventory/warehouses', icon: Layers, color: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100' },
  { id: 'sales', label: 'فاتورة بيع', path: '/invoices/sales', icon: ShoppingCart, color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
  { id: 'purchases', label: 'فاتورة شراء', path: '/invoices/purchases', icon: FileText, color: 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100' },
  { id: 'bonds_in', label: 'سند قبض', path: '/bonds/collection', icon: ArrowDownToLine, color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
  { id: 'bonds_out', label: 'سند صرف', path: '/bonds/payment', icon: ArrowUpFromLine, color: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' },
  { id: 'customers', label: 'العملاء', path: '/customers', icon: Users, color: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100' },
  { id: 'suppliers', label: 'الموردون', path: '/suppliers', icon: TrendingUp, color: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' },
  { id: 'safes', label: 'الصناديق', path: '/treasury/safes', icon: Wallet, color: 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100' },
];

function numberValue(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(value: unknown, digits = 0): string {
  return numberValue(value).toLocaleString('ar-SY', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtMoney(value: unknown, currency = 'USD'): string {
  return `${fmtNumber(value, 2)} ${currency}`;
}

export const Dashboard = () => {
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
      setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات لوحة التحكم');
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

  const activeLinks = quickLinks.filter((link) => selectedLinkIds.includes(link.id));

  const cards = useMemo(() => {
    const d = summary;
    return [
      { label: 'العملاء', value: fmtNumber(d?.customers_count), icon: Users, bg: 'bg-indigo-50', color: 'text-indigo-700' },
      { label: 'الموردون', value: fmtNumber(d?.suppliers_count), icon: TrendingUp, bg: 'bg-orange-50', color: 'text-orange-700' },
      { label: 'إجمالي الأتواب', value: fmtNumber(d?.fabric_rolls_count), icon: Package, bg: 'bg-cyan-50', color: 'text-cyan-700' },
      { label: 'الأتواب النشطة', value: fmtNumber(d?.active_fabric_rolls_count), icon: Package, bg: 'bg-emerald-50', color: 'text-emerald-700' },
      { label: 'إجمالي الأمتار', value: fmtNumber(d?.total_roll_length_m, 2), icon: Layers, bg: 'bg-blue-50', color: 'text-blue-700' },
      { label: 'إجمالي الوزن كغ', value: fmtNumber(d?.total_roll_weight_kg, 2), icon: Layers, bg: 'bg-slate-50', color: 'text-slate-700' },
      { label: 'سندات القبض', value: fmtMoney(d?.receipt_total), icon: ArrowDownToLine, bg: 'bg-green-50', color: 'text-green-700' },
      { label: 'سندات الصرف', value: fmtMoney(d?.payment_total), icon: ArrowUpFromLine, bg: 'bg-rose-50', color: 'text-rose-700' },
    ];
  }, [summary]);

  const operations = [
    { label: 'المستودعات', value: fmtNumber(summary?.warehouses_count), path: '/inventory/warehouses' },
    { label: 'دفعات الاستيراد', value: fmtNumber(summary?.purchase_import_batches_count), path: '/purchases/import-batches' },
    { label: 'حركات المخزون', value: fmtNumber(summary?.inventory_movements_count), path: '/reports' },
    { label: 'السندات', value: fmtNumber(summary?.vouchers_count), path: '/bonds/records' },
    { label: 'المرتجعات', value: fmtNumber(summary?.return_invoices_count), path: '/invoices/returns' },
    { label: 'النقل بين المستودعات', value: fmtNumber(summary?.transfers_count), path: '/inventory/transfers' },
  ];

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
          <h2 className="text-2xl font-black text-slate-950">لوحة التحكم</h2>
          <p className="mt-1 text-sm text-slate-500">بيانات تشغيلية مباشرة من قاعدة بيانات المشروع.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
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
            <h3 className="text-lg font-black text-slate-900">وصول سريع</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{activeLinks.length} اختصار</span>
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
            تخصيص
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {activeLinks.map((link) => (
            <Link key={link.id} to={link.path} className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center shadow-sm transition ${link.color}`}>
              <link.icon className="h-6 w-6" />
              <span className="text-sm font-black">{link.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className={`rounded-2xl p-4 ${card.bg}`}>
              <card.icon className={`h-6 w-6 ${card.color}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">{card.label}</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{loading ? '...' : card.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 text-lg font-black text-slate-900">مؤشرات تشغيلية</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {operations.map((item) => (
              <Link key={item.label} to={item.path} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 transition hover:border-indigo-200 hover:bg-indigo-50">
                <span className="font-bold text-slate-700">{item.label}</span>
                <span className="font-mono text-lg font-black text-slate-950">{loading ? '...' : item.value}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-lg font-black text-slate-900">أرصدة الصناديق</h3>
            {cashRows.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-4 text-center text-sm font-bold text-slate-500">لا توجد صناديق نشطة</div>
            ) : (
              <div className="space-y-2">
                {cashRows.map((row) => (
                  <div key={row.currency_code} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="font-black text-slate-700">{row.currency_code}</span>
                    <span className="font-mono text-lg font-black text-emerald-700">{fmtMoney(row.total, row.currency_code)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`rounded-2xl border p-5 shadow-sm ${damagedRolls > 0 ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className="flex items-center gap-3">
              <AlertTriangle className={`h-6 w-6 ${damagedRolls > 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
              <div>
                <p className="text-sm font-bold text-slate-600">أتواب تالفة / هالك</p>
                <p className={`text-2xl font-black ${damagedRolls > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{loading ? '...' : fmtNumber(damagedRolls)}</p>
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
                تخصيص الوصول السريع
              </h3>
              <button type="button" onClick={() => setIsSettingsOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
              {quickLinks.map((link) => {
                const selected = tempSelected.includes(link.id);
                return (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => setTempSelected((prev) => (prev.includes(link.id) ? prev.filter((id) => id !== link.id) : [...prev, link.id]))}
                    className={`flex items-center justify-between rounded-xl border p-3 text-right transition ${
                      selected ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-3 font-black">
                      <link.icon className="h-5 w-5" />
                      {link.label}
                    </span>
                    {selected && <Check className="h-5 w-5 text-indigo-600" />}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-4">
              <button type="button" onClick={() => setIsSettingsOpen(false)} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-white">
                إلغاء
              </button>
              <button type="button" onClick={handleSaveSettings} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-black text-white hover:bg-indigo-700">
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
