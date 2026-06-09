import React, { useState, useEffect, useCallback } from 'react';
import { FolderTree, Search, ChevronDown, ChevronLeft, Folder, FileText, RefreshCw } from 'lucide-react';
import { fetchChartOfAccounts, type ChartAccountRow } from '../lib/api/financeApi';

const typeTranslations: Record<string, string> = {
  asset: 'أصل',
  liability: 'خصم',
  equity: 'حقوق ملكية',
  revenue: 'إيراد',
  expense: 'مصروف',
};

const AccountRow = ({
  account,
  allAccounts,
  level = 0,
  searchTerm,
}: {
  key?: React.Key;
  account: ChartAccountRow;
  allAccounts: ChartAccountRow[];
  level?: number;
  searchTerm: string;
}) => {
  const [isExpanded, setIsExpanded] = useState(level < 1);
  const children = allAccounts.filter((a) => a.parentId === account.id);
  const hasChildren = children.length > 0;

  const shouldExpand = searchTerm.length > 0 || isExpanded;

  return (
    <React.Fragment>
      <tr
        className={`border-b border-slate-100 transition-colors ${
          level === 0 ? 'bg-slate-100 hover:bg-slate-200' : 'bg-white hover:bg-slate-50'
        }`}
      >
        <td className="px-6 py-3">
          <div className="flex items-center gap-2" style={{ paddingRight: `${level * 2}rem` }}>
            {hasChildren ? (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors"
              >
                {shouldExpand ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
            ) : (
              <span className="w-6" />
            )}
            {hasChildren ? (
              <Folder className={`w-4 h-4 ${level === 0 ? 'text-indigo-600' : 'text-indigo-400'}`} />
            ) : (
              <FileText className="w-4 h-4 text-slate-400" />
            )}
            <span className={`font-medium ${level === 0 ? 'text-indigo-900' : 'text-slate-900'}`}>{account.code}</span>
          </div>
        </td>
        <td className={`px-6 py-3 ${hasChildren ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
          {account.name}
          {account.source_note && (
            <span className="block text-[11px] font-normal text-slate-400 mt-0.5">{account.source_note}</span>
          )}
        </td>
        <td className="px-6 py-3">
          <span
            className={`px-2 py-1 rounded text-xs ${
              level === 0 ? 'font-bold bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {typeTranslations[account.type] || account.type}
          </span>
        </td>
        <td
          className={`px-6 py-3 font-semibold text-left ${
            account.type === 'asset' || account.type === 'expense' ? 'text-indigo-600' : 'text-emerald-600'
          }`}
        >
          {account.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {account.currency_code ? (
            <span className="text-xs font-normal text-slate-400 mr-1">{account.currency_code}</span>
          ) : null}
        </td>
      </tr>
      {shouldExpand &&
        children.map((child) => (
          <AccountRow key={child.id} account={child} allAccounts={allAccounts} level={level + 1} searchTerm={searchTerm} />
        ))}
    </React.Fragment>
  );
};

export const Accounting = () => {
  const [accounts, setAccounts] = useState<ChartAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [metaNote, setMetaNote] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchChartOfAccounts();
      setAccounts(res.data ?? []);
      setMetaNote(res.meta?.note ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر تحميل شجرة الحسابات');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredAccounts = accounts.filter(
    (a) => a.name.includes(searchTerm) || a.code.includes(searchTerm) || a.id.includes(searchTerm),
  );

  const rootAccounts = accounts.filter((a) => !a.parentId);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">شجرة الحسابات</h2>
          <p className="text-slate-500 mt-1">الدليل التشغيلي مرتبط بقاعدة البيانات — صناديق، سندات، مرتجعات ورواتب</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
          <button
            type="button"
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm opacity-60 cursor-not-allowed"
            title="التعديل اليدوي للدليل سيتم لاحقاً — حالياً الأرصدة مولَّدة آلياً"
          >
            <FolderTree className="w-4 h-4" />
            <span>إضافة حساب جديد</span>
          </button>
        </div>
      </div>

      {metaNote && (
        <div className="rounded-lg border border-amber-100 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">{metaNote}</div>
      )}
      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center gap-4 bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث برقم الحساب أو اسمه..."
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          {loading && <span className="text-sm text-slate-500">جاري التحميل…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-6 py-4 w-1/4">رقم الحساب</th>
                <th className="px-6 py-4 w-1/3">اسم الحساب</th>
                <th className="px-6 py-4 w-1/4">النوع / التصنيف</th>
                <th className="px-6 py-4 w-1/4 text-left">الرصيد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {searchTerm ? (
                filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50 transition-colors bg-white">
                    <td className="px-6 py-3 font-medium text-indigo-600">{acc.code}</td>
                    <td className="px-6 py-3 text-slate-900 font-semibold">
                      {acc.name}
                      {acc.source_note && (
                        <span className="block text-[11px] font-normal text-slate-400">{acc.source_note}</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <span className="px-2 py-1 bg-slate-100 rounded text-slate-700 text-xs">
                        {typeTranslations[acc.type] || acc.type}
                      </span>
                    </td>
                    <td
                      className={`px-6 py-3 font-semibold text-left ${
                        acc.type === 'asset' || acc.type === 'expense' ? 'text-indigo-600' : 'text-emerald-600'
                      }`}
                    >
                      {acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              ) : (
                rootAccounts.map((root) => (
                  <AccountRow key={root.id} account={root} allAccounts={accounts} searchTerm={searchTerm} />
                ))
              )}
              {!loading && accounts.length === 0 && !err && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    لا تتوفر بيانات مالية بعد — تأكد من الاتصال بالخادم ووجود صناديق أو سندات.
                  </td>
                </tr>
              )}
              {searchTerm && filteredAccounts.length === 0 && accounts.length > 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    لا توجد نتائج مطابقة لبحثك.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
