import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileUp } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { listImportBatches, type PurchaseImportBatchDto } from '../../lib/api/purchaseImportApi';

const statusLabel: Record<string, string> = {
  PREVIEW: 'معاينة',
  PREVIEWED: 'معاينة',
  VALIDATED: 'مسعّر',
  CONFIRMING: 'جاري الترحيل',
  CONFIRMED: 'مؤكد',
  PARTIALLY_CONFIRMED: 'مؤكد جزئياً',
  FAILED: 'فشل',
  CANCELLED: 'ملغى',
};

export const ImportBatches = () => {
  const [rows, setRows] = useState<PurchaseImportBatchDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listImportBatches({ pageSize: 50 });
      setRows(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل سجل الاستيراد');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link to="/purchases" className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">سجل استيراد فواتير الشراء</h2>
            <p className="text-slate-500 mt-1 text-sm">دفعات Excel المستوردة ونتائج الترحيل</p>
          </div>
        </div>
        <Link
          to="/purchases/import-excel"
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 text-sm font-bold"
        >
          <FileUp className="w-4 h-4" />
          استيراد جديد
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {error && <div className="px-4 py-3 text-sm text-rose-700 bg-rose-50">{error}</div>}
        {loading ? (
          <div className="p-10 text-center text-slate-500">جاري التحميل...</div>
        ) : (
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-100 text-slate-600 font-bold">
              <tr>
                <th className="px-4 py-3">الملف</th>
                <th className="px-4 py-3">المورد</th>
                <th className="px-4 py-3">الأتواب</th>
                <th className="px-4 py-3">الأمتار</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{b.file_name}</td>
                  <td className="px-4 py-3">{b.supplier_name ?? '—'}</td>
                  <td className="px-4 py-3 font-mono">{b.row_count}</td>
                  <td className="px-4 py-3 font-mono">{Number(b.total_length_m).toLocaleString('ar-EG')}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold">
                      {statusLabel[b.status] ?? b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {b.created_at ? format(new Date(b.created_at), 'dd/MM/yyyy', { locale: ar }) : '—'}
                  </td>
                </tr>
              ))}
              {!rows.length && !error && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">لا توجد دفعات استيراد بعد</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
