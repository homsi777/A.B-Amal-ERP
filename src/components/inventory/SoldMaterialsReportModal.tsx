import React, { useEffect, useState } from 'react';
import { Download, Loader2, Search, X } from 'lucide-react';
import { listSoldMaterialReport, type SoldMaterialReportRow } from '../../lib/api/soldMaterialsReportApi';
import { renderSoldMaterialsReportA4Html } from '../../lib/printing/renderSoldMaterialsReportA4';
import { exportPrintHtmlToPdf } from '../../lib/printing/documentPrint';

function formatNumber(value: string | number, digits = 2): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '0.00';
}

export function SoldMaterialsReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<SoldMaterialReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void listSoldMaterialReport({ search, page: 1, pageSize: 50000 })
        .then((result) => {
          setRows(result.data);
          setTotal(result.total);
        })
        .catch((requestError: unknown) => {
          setRows([]);
          setTotal(0);
          setError(requestError instanceof Error ? requestError.message : 'تعذر تحميل تقرير الخامات المباعة.');
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, search]);

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const html = renderSoldMaterialsReportA4Html({ rows, searchQuery: search, printedAt: new Date() });
      await exportPrintHtmlToPdf(html, 'تقرير_خامات_مباعة', { orientation: 'landscape' });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'تعذر تصدير التقرير إلى PDF.');
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="تقرير خامات مباعة">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">تقرير خامات مباعة</h3>
            <p className="mt-0.5 text-xs text-slate-500">يعرض بنود الخامات من فواتير البيع المؤكدة فقط.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالخامة أو كودها أو الزبون أو رقم الفاتورة..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm outline-none focus:border-indigo-500"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={exporting || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? 'جاري التصدير...' : 'تصدير PDF'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div> : null}
          <div className="mb-3 text-sm text-slate-600">عدد بنود البيع: <span className="font-bold text-slate-900">{total.toLocaleString('en-US')}</span></div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[1080px] w-full text-right text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs text-slate-700">
                <tr>
                  <th className="px-3 py-3">اسم الخامة</th><th className="px-3 py-3">الكود</th><th className="px-3 py-3">الزبون</th><th className="px-3 py-3 text-center">الكمية</th><th className="px-3 py-3 text-center">متر</th><th className="px-3 py-3 text-center">سعر البيع</th><th className="px-3 py-3 text-center">رقم الفاتورة</th><th className="px-3 py-3 text-center">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500"><Loader2 className="ml-2 inline h-5 w-5 animate-spin" />جاري تحميل بنود البيع...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">لا توجد خامات مباعة مطابقة للبحث.</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-3 font-bold text-slate-800">{row.material_name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">{row.material_code || '—'}</td>
                    <td className="px-3 py-3">{row.customer_name}</td>
                    <td className="px-3 py-3 text-center font-mono">{formatNumber(row.quantity, 3)} {row.unit === 'yard' ? 'ياردة' : 'متر'}</td>
                    <td className="px-3 py-3 text-center font-mono">{formatNumber(row.meters, 3)}</td>
                    <td className="px-3 py-3 text-center font-mono">{formatNumber(row.unit_price)} {row.currency_code}</td>
                    <td className="px-3 py-3 text-center font-mono">{row.invoice_no}</td>
                    <td className="px-3 py-3 text-center font-mono">{String(row.invoice_date).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
