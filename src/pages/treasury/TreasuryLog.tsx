import React, { useCallback, useEffect, useState } from 'react';
import { Search, Filter, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { listAllCashboxMovements, type CashboxMovementRow } from '../../lib/api/cashboxesApi';
import { ApiRequestError } from '../../lib/api/client';

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  OPENING: 'افتتاح',
  RECEIPT: 'قبض',
  PAYMENT: 'صرف',
  TRANSFER_IN: 'مناقلة وارد',
  TRANSFER_OUT: 'مناقلة صادر',
  ADJUSTMENT: 'تعديل',
};

const PARTY_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: 'عميل',
  SUPPLIER: 'مورد',
  EMPLOYEE: 'موظف',
  OTHER: 'أخرى',
};

function movementTypeLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type] ?? type;
}

function partyTypeLabel(type: string | null | undefined): string {
  if (!type) return '';
  return PARTY_TYPE_LABELS[type] ?? type;
}

export const TreasuryLog = () => {
  const [logs, setLogs] = useState<CashboxMovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAllCashboxMovements({
        pageSize: 200,
        search: searchDebounced || undefined,
      });
      setLogs(res.data);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'تعذر تحميل الحركات');
    } finally {
      setLoading(false);
    }
  }, [searchDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  const isIn = (direction: string) => direction === 'IN';

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">سجل حركة الصناديق</h2>
        <p className="text-slate-500 mt-1">
          حركات مؤكدة من الخادم — مع اسم الجهة (عميل، مورد، موظف، …) حسب مصدر الحركة
        </p>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم الجهة أو رقم الحركة أو البيان..."
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm"
          >
            <Filter className="w-4 h-4" />
            <span>تحديث</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-5 py-4">رقم الحركة</th>
                <th className="px-5 py-4">التاريخ</th>
                <th className="px-5 py-4">اسم الجهة</th>
                <th className="px-5 py-4">الصندوق</th>
                <th className="px-5 py-4">النوع</th>
                <th className="px-5 py-4">الاتجاه</th>
                <th className="px-5 py-4">المبلغ</th>
                <th className="px-5 py-4">سعر الصرف</th>
                <th className="px-5 py-4">بالدولار</th>
                <th className="px-5 py-4">البيان</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
                    جاري التحميل...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                    لا توجد حركات صناديق بعد
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors bg-white">
                    <td className="px-5 py-4 font-medium text-indigo-600 font-mono text-xs">{log.movement_no}</td>
                    <td className="px-5 py-4 text-slate-600 font-medium whitespace-nowrap">
                      {new Date(log.movement_at).toLocaleDateString('ar-SY')}
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{log.party_name || '—'}</div>
                      {log.party_type ? (
                        <div className="text-xs text-slate-400 mt-0.5">{partyTypeLabel(log.party_type)}</div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-slate-900 font-semibold">{log.cashbox_name || '—'}</td>
                    <td className="px-5 py-4 text-slate-600">{movementTypeLabel(log.movement_type)}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`flex items-center gap-1 w-max px-2 py-1 rounded text-xs font-bold ${
                          isIn(log.direction) ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {isIn(log.direction) ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {isIn(log.direction) ? 'وارد' : 'صادر'}
                      </span>
                    </td>
                    <td className={`px-5 py-4 font-bold whitespace-nowrap ${isIn(log.direction) ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {isIn(log.direction) ? '+' : '-'}
                      {Number(log.amount).toLocaleString()} {log.currency_code}
                    </td>
                    <td className="px-5 py-4 font-mono text-slate-700">
                      {log.currency_code === 'USD' ? '1' : log.exchange_rate_to_usd ? String(log.exchange_rate_to_usd) : '—'}
                    </td>
                    <td className="px-5 py-4 font-mono text-slate-900 whitespace-nowrap">
                      {log.amount_usd ? `${Number(log.amount_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD` : '—'}
                    </td>
                    <td className="px-5 py-4 text-slate-600 max-w-xs truncate" title={log.description}>
                      {log.description}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
