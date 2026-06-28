import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { ArrowRight, Briefcase, Filter, Loader2, Search } from 'lucide-react';
import { listPayrollSalaryLog, type PayrollSalaryLogRow } from '../lib/api/payrollApi';
import { ApiRequestError } from '../lib/api/client';

function money(value: string | number, currency = 'USD'): string {
  return `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function paymentTypeLabel(type: PayrollSalaryLogRow['payment_type']): string {
  return type === 'ADVANCE' ? 'سلفة' : 'راتب';
}

export const PayrollSalaryLog = () => {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<PayrollSalaryLogRow[]>([]);
  const [totalsByCurrency, setTotalsByCurrency] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');
  const [paymentType, setPaymentType] = useState<'ALL' | 'SALARY' | 'ADVANCE'>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPayrollSalaryLog({
        search: search.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sortBy,
        paymentType,
        pageSize: 200,
      });
      setRows(res.data);
      setTotal(res.total);
      setTotalsByCurrency(res.totalsByCurrency ?? {});
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'تعذر تحميل سجل الرواتب');
    } finally {
      setLoading(false);
    }
  }, [search, dateFrom, dateTo, sortBy, paymentType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <Link
            to="/salaries"
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 mb-2"
          >
            <ArrowRight className="w-4 h-4" />
            العودة إلى الموظفون والتسليم
          </Link>
          <h2 className="text-2xl font-bold text-slate-900">سجل الرواتب</h2>
          <p className="text-slate-500 mt-1">
            كل تسليمات الرواتب والسلف المدفوعة — حسب التاريخ أو اسم الموظف مع إجمالي المبالغ.
          </p>
        </div>
        <Link
          to="/salaries"
          className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
        >
          <Briefcase className="w-4 h-4" />
          الموظفون والتسليم
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>
      )}

      {Object.keys(totalsByCurrency).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(totalsByCurrency).map(([currency, sum]) => (
            <div key={currency} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500 font-bold">إجمالي المدفوع ({currency})</p>
              <p className="mt-1 text-xl font-black text-emerald-700">{money(sum, currency)}</p>
              <p className="text-xs text-slate-400 mt-1">{total} عملية في السجل</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 items-end bg-slate-50">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم الموظف أو الرمز..."
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">نوع الدفعة</label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as 'ALL' | 'SALARY' | 'ADVANCE')}
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm"
            >
              <option value="ALL">الكل (رواتب + سلف)</option>
              <option value="SALARY">رواتب فقط</option>
              <option value="ADVANCE">سلف فقط</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">ترتيب</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'date' | 'name')}
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm"
            >
              <option value="date">التاريخ (الأحدث أولاً)</option>
              <option value="name">اسم الموظف</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm"
          >
            <Filter className="w-4 h-4" />
            تطبيق
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-5 py-4">اسم الموظف</th>
                <th className="px-5 py-4">النوع</th>
                <th className="px-5 py-4">تاريخ الدفع</th>
                <th className="px-5 py-4">الفترة</th>
                <th className="px-5 py-4">رقم المستند</th>
                <th className="px-5 py-4">المبلغ</th>
                <th className="px-5 py-4">الصندوق</th>
                <th className="px-5 py-4">البيان</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin inline ml-2" />
                    جاري التحميل...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                    لا توجد دفعات (رواتب أو سلف) في السجل.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.payment_type}-${row.id}`} className="hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-900">{row.full_name}</div>
                      <div className="text-xs text-slate-400 font-mono">{row.employee_code}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-bold ${
                          row.payment_type === 'ADVANCE'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {paymentTypeLabel(row.payment_type)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-700 whitespace-nowrap">
                      {format(new Date(row.payment_date), 'PP', { locale: ar })}
                    </td>
                    <td className="px-5 py-4 text-slate-600 whitespace-nowrap">
                      {row.period_month}/{row.period_year}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600">
                      {row.document_no || row.payroll_no}
                    </td>
                    <td className="px-5 py-4 font-bold text-emerald-700 whitespace-nowrap">
                      {money(row.net_salary, row.currency_code)}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{row.cashbox_name ?? '—'}</td>
                    <td className="px-5 py-4 text-slate-600 max-w-xs truncate" title={row.line_notes || row.run_notes || ''}>
                      {row.line_notes || row.run_notes || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200">
                <tr>
                  <td colSpan={5} className="px-5 py-4 text-slate-700">
                    الإجمالي ({total} سجل)
                  </td>
                  <td colSpan={3} className="px-5 py-4">
                    {Object.entries(totalsByCurrency).map(([currency, sum]) => (
                      <span key={currency} className="inline-block ml-4 text-emerald-800">
                        {money(sum, currency)}
                      </span>
                    ))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
