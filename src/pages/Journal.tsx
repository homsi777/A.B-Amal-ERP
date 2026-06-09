import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Search, Filter, Plus, RefreshCw, X, Trash2 } from 'lucide-react';
import {
  fetchJournalLines,
  fetchGlPostingAccounts,
  postManualJournalEntry,
  type GlPostingAccountRow,
  type JournalLineRow,
} from '../lib/api/financeApi';
import { ApiRequestError } from '../lib/api/client';

const SOURCE_TYPE_AR: Record<string, string> = {
  VOUCHER: 'سند قبض / دفع',
  VOUCHER_REVERSAL: 'عكس سند',
  RETURN_INVOICE: 'فاتورة مرتجع',
  RETURN_INVOICE_REVERSAL: 'عكس مرتجع',
  PAYROLL_ACCRUAL: 'استحقاق رواتب',
  PAYROLL_PAYMENT: 'صرف رواتب (خزينة)',
  PAYROLL_REVERSAL: 'عكس رواتب',
  MANUAL: 'قيد يدوي',
  OPENING: 'افتتاحي',
  SYSTEM: 'نظام',
};

function formatSourceType(st: string | null | undefined): string {
  if (!st) return '—';
  return SOURCE_TYPE_AR[st] ?? st;
}

type DraftLine = { glAccountId: string; debit: string; credit: string; lineDesc: string };

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const Journal = () => {
  const [lines, setLines] = useState<JournalLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [metaNote, setMetaNote] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [manualOpen, setManualOpen] = useState(false);
  const [glAccounts, setGlAccounts] = useState<GlPostingAccountRow[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualErr, setManualErr] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(todayIsoDate);
  const [entryDesc, setEntryDesc] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { glAccountId: '', debit: '', credit: '', lineDesc: '' },
    { glAccountId: '', debit: '', credit: '', lineDesc: '' },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchJournalLines({
        search: search.trim() || undefined,
        dateFrom: dateFrom.trim() || undefined,
        dateTo: dateTo.trim() || undefined,
        limit: 800,
      });
      setLines(res.data ?? []);
      setMetaNote(res.meta?.note ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر تحميل دفتر اليومية');
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [search, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput), 380);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const sortedLines = useMemo(() => {
    return [...lines].sort((a, b) => {
      if (a.date !== b.date) return new Date(b.date).getTime() - new Date(a.date).getTime();
      if (a.entry_id !== b.entry_id) return b.entry_id.localeCompare(a.entry_id);
      return a.line_no - b.line_no;
    });
  }, [lines]);

  const openManual = useCallback(async () => {
    setManualOpen(true);
    setManualErr(null);
    setEntryDate(todayIsoDate());
    setEntryDesc('');
    setDraftLines([
      { glAccountId: '', debit: '', credit: '', lineDesc: '' },
      { glAccountId: '', debit: '', credit: '', lineDesc: '' },
    ]);
    try {
      const res = await fetchGlPostingAccounts();
      setGlAccounts(res.data ?? []);
    } catch (e) {
      setGlAccounts([]);
      setManualErr(e instanceof Error ? e.message : 'تعذر تحميل دليل الحسابات');
    }
  }, []);

  const closeManual = () => {
    setManualOpen(false);
    setManualErr(null);
    setManualLoading(false);
  };

  const parsedDraftTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const row of draftLines) {
      const d = Math.round((parseFloat(row.debit.replace(/,/g, '')) || 0) * 100) / 100;
      const c = Math.round((parseFloat(row.credit.replace(/,/g, '')) || 0) * 100) / 100;
      debit += d;
      credit += c;
    }
    debit = Math.round(debit * 100) / 100;
    credit = Math.round(credit * 100) / 100;
    return { debit, credit, balanced: debit === credit };
  }, [draftLines]);

  const submitManual = async () => {
    setManualErr(null);
    const desc = entryDesc.trim();
    if (!desc) {
      setManualErr('أدخل وصفاً للقيد.');
      return;
    }
    const built: { glAccountId: string; debit: number; credit: number; description: string | null }[] = [];
    for (const row of draftLines) {
      const d = Math.round((parseFloat(row.debit.replace(/,/g, '')) || 0) * 100) / 100;
      const c = Math.round((parseFloat(row.credit.replace(/,/g, '')) || 0) * 100) / 100;
      if (!row.glAccountId && d === 0 && c === 0) continue;
      if (!row.glAccountId) {
        setManualErr('كل سطر بمبلغ يجب أن يحدد الحساب.');
        return;
      }
      if (d > 0 && c > 0) {
        setManualErr('السطر لا يجمع مديناً ودائناً معاً.');
        return;
      }
      if (d === 0 && c === 0) {
        setManualErr('احذف الأسطر الفارغة أو أدخل مبلغاً.');
        return;
      }
      built.push({
        glAccountId: row.glAccountId,
        debit: d,
        credit: c,
        description: row.lineDesc.trim() || null,
      });
    }
    if (built.length < 2) {
      setManualErr('القيد يحتاج سطرين على الأقل متوازنين.');
      return;
    }
    const sumD = Math.round(built.reduce((s, x) => s + x.debit, 0) * 100) / 100;
    const sumC = Math.round(built.reduce((s, x) => s + x.credit, 0) * 100) / 100;
    if (sumD !== sumC) {
      setManualErr(`القيد غير متوازن: مجموع المدين ${sumD} والدائن ${sumC}.`);
      return;
    }
    setManualLoading(true);
    try {
      await postManualJournalEntry({
        entryDate: entryDate,
        description: desc,
        lines: built.map((b) => ({
          glAccountId: b.glAccountId,
          debit: b.debit,
          credit: b.credit,
          description: b.description,
        })),
      });
      closeManual();
      await load();
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : 'فشل حفظ القيد';
      setManualErr(msg);
    } finally {
      setManualLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">دفتر اليومية</h2>
          <p className="text-slate-500 mt-1">قيود مزدوجة مُرحَّلة من السندات والمرتجعات والرواتب والقيود اليدوية (مدين / دائن)</p>
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
            onClick={() => void openManual()}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء قيد يدوي</span>
          </button>
        </div>
      </div>

      {metaNote && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm text-indigo-950">{metaNote}</div>
      )}
      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="بحث برقم السند، الجهة، أو البيان..."
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              title="من تاريخ"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              title="إلى تاريخ"
            />
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition shadow-sm font-medium"
            >
              <Filter className="w-4 h-4" />
              <span>تطبيق الفلتر</span>
            </button>
          </div>
          {loading && <span className="text-sm text-slate-500 w-full sm:w-auto">جاري التحميل…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-6 py-4">رقم القيد</th>
                <th className="px-6 py-4">التاريخ</th>
                <th className="px-6 py-4">مصدر القيد</th>
                <th className="px-6 py-4">رقم واسم الحساب</th>
                <th className="px-6 py-4">الجهة</th>
                <th className="px-6 py-4">البيان</th>
                <th className="px-6 py-4 text-left">مدين</th>
                <th className="px-6 py-4 text-left">دائن</th>
                <th className="px-6 py-4">ع.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && sortedLines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                    لا توجد قيود مطابقة للفلتر — أو لا بيانات مرحّلة بعد.
                  </td>
                </tr>
              ) : (
                sortedLines.map((t, idx) => {
                  const isSameEntry = idx > 0 && sortedLines[idx - 1].entry_id === t.entry_id;
                  return (
                    <tr
                      key={`${t.entry_id}-${t.line_no}-${t.account_id}`}
                      className={`hover:bg-slate-50 transition-colors bg-white ${
                        isSameEntry ? 'border-t-0 bg-slate-50/30' : 'border-t-2 border-slate-200'
                      }`}
                    >
                      <td className="px-6 py-4 font-mono font-medium text-slate-500">{t.entry_id}</td>
                      <td className="px-6 py-4 text-slate-600 font-medium">{new Date(t.date).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-slate-700 text-xs">{formatSourceType(t.source_type)}</td>
                      <td className="px-6 py-4 font-bold text-slate-900">
                        <span className="text-indigo-600 font-mono text-xs px-2 py-1 bg-indigo-50 rounded ml-2">
                          {t.account_id}
                        </span>
                        {t.account_name}
                      </td>
                      <td className="px-6 py-4 text-slate-600 text-xs">{t.party_name ?? '—'}</td>
                      <td className="px-6 py-4 text-slate-700">{t.description ?? '—'}</td>
                      <td className="px-6 py-4 font-bold text-left text-emerald-600">
                        {t.debit > 0 ? t.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="px-6 py-4 font-bold text-left text-rose-600">
                        {t.credit > 0 ? t.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">{t.currency_code}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {manualOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-journal-title"
        >
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            <button
              type="button"
              onClick={closeManual}
              className="absolute left-4 top-4 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition z-10"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="border-b border-slate-200 px-6 pb-4 pt-6 pr-14 bg-slate-50/80">
              <h3 id="manual-journal-title" className="text-xl font-bold text-slate-900">
                قيد يدوي في دفتر الأستاذ العام
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                قيد متوازن (مدين = دائن). يُستخدم للتسويات والافتتاحيات وما لا يولّده النظام تلقائياً.
              </p>
            </div>

            <div className="space-y-5 p-6">
              {manualErr && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{manualErr}</div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">تاريخ القيد</label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-slate-700">الوصف العام</label>
                  <input
                    type="text"
                    value={entryDesc}
                    onChange={(e) => setEntryDesc(e.target.value)}
                    placeholder="مثال: تسوية بنكية — رسوم الشهر"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
                  <span className="text-sm font-semibold text-slate-800">أسطر القيد</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftLines((rows) => [...rows, { glAccountId: '', debit: '', credit: '', lineDesc: '' }])
                    }
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    سطر
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {draftLines.map((row, i) => (
                    <div key={i} className="p-4 grid gap-3 sm:grid-cols-12 bg-white">
                      <div className="sm:col-span-5 space-y-1">
                        <label className="text-xs font-medium text-slate-500">الحساب</label>
                        <select
                          value={row.glAccountId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftLines((rows) => rows.map((r, j) => (j === i ? { ...r, glAccountId: v } : r)));
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">— اختر حساباً —</option>
                          {glAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2 space-y-1">
                        <label className="text-xs font-medium text-slate-500">مدين</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.debit}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftLines((rows) =>
                              rows.map((r, j) => (j === i ? { ...r, debit: v, credit: v ? '' : r.credit } : r)),
                            );
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                          placeholder="0"
                        />
                      </div>
                      <div className="sm:col-span-2 space-y-1">
                        <label className="text-xs font-medium text-slate-500">دائن</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.credit}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftLines((rows) =>
                              rows.map((r, j) => (j === i ? { ...r, credit: v, debit: v ? '' : r.debit } : r)),
                            );
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                          placeholder="0"
                        />
                      </div>
                      <div className="sm:col-span-2 space-y-1">
                        <label className="text-xs font-medium text-slate-500">بيان السطر</label>
                        <input
                          type="text"
                          value={row.lineDesc}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftLines((rows) => rows.map((r, j) => (j === i ? { ...r, lineDesc: v } : r)));
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          placeholder="اختياري"
                        />
                      </div>
                      <div className="sm:col-span-1 flex items-end justify-end">
                        <button
                          type="button"
                          disabled={draftLines.length <= 2}
                          onClick={() => setDraftLines((rows) => rows.filter((_, j) => j !== i))}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:pointer-events-none"
                          title="حذف السطر"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className={`rounded-lg border px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2 ${
                  parsedDraftTotals.balanced
                    ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                    : 'border-amber-200 bg-amber-50/90 text-amber-950'
                }`}
              >
                <span>
                  المجموع — مدين:{' '}
                  <strong>{parsedDraftTotals.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  {' · '}
                  دائن:{' '}
                  <strong>{parsedDraftTotals.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </span>
                {parsedDraftTotals.balanced ? (
                  <span className="font-medium">متوازن ✓</span>
                ) : (
                  <span className="font-medium">يجب أن يتساوى المدين والدائن</span>
                )}
              </div>

              {glAccounts.length === 0 && !manualErr && (
                <p className="text-xs text-amber-800">لا حسابات مرحّل إليها من الخادم — تأكد من تشغيل الترحيلات ووجود شركة نشطة.</p>
              )}

              <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeManual}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-medium"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={
                    manualLoading ||
                    !parsedDraftTotals.balanced ||
                    (parsedDraftTotals.debit === 0 && parsedDraftTotals.credit === 0)
                  }
                  onClick={() => void submitManual()}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {manualLoading ? 'جاري الحفظ…' : 'ترحيل القيد'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
