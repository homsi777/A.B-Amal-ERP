import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet, RefreshCw, CheckCircle2, XCircle, Clock,
  Package, ArrowRight, Upload, Eye, Tags,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  listImportBatches, cancelImportBatch,
  type PurchaseImportBatchDto, type BatchStatus,
} from '../../lib/api/purchaseImportApi';
import { useToast } from '../../components/NonBlockingToast';

// ─── Status helpers ───────────────────────────────────────────────────────────

const BATCH_STATUS_LABEL: Partial<Record<BatchStatus, string>> = {
  PREVIEW:   'معاينة',
  VALIDATED: 'مُتحقَّق',
  CONFIRMED: 'مؤكَّد',
  FAILED:    'فشل',
  CANCELLED: 'ملغى',
};
const BATCH_STATUS_COLOR: Partial<Record<BatchStatus, string>> = {
  PREVIEW:   'bg-blue-100 text-blue-700 border-blue-200',
  VALIDATED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  CONFIRMED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FAILED:    'bg-rose-100 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};
const getBatchStatusLabel = (status: BatchStatus) => {
  if (status === 'PREVIEWED') return 'معلّقة بانتظار الاستلام';
  if (status === 'CONFIRMING') return 'جاري التأكيد';
  if (status === 'PARTIALLY_CONFIRMED') return 'مؤكدة جزئياً';
  return BATCH_STATUS_LABEL[status] ?? status;
};

const getBatchStatusColor = (status: BatchStatus) => {
  if (status === 'PREVIEWED') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (status === 'CONFIRMING') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (status === 'PARTIALLY_CONFIRMED') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  return BATCH_STATUS_COLOR[status] ?? '';
};

const BatchStatusBadge = ({ status }: { status: BatchStatus }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${getBatchStatusColor(status)}`}>
    {getBatchStatusLabel(status)}
  </span>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export const ImportBatches = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [batches, setBatches] = useState<PurchaseImportBatchDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [pendingCancelUntil, setPendingCancelUntil] = useState(0);
  const PAGE_SIZE = 20;

  const load = useCallback(async (p: number) => {
    setLoading(true); setError('');
    try {
      const res = await listImportBatches({ page: p, pageSize: PAGE_SIZE });
      setBatches(res.data);
      setTotal(res.total);
    } catch {
      setError('تعذر تحميل سجل الاستيرادات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  const handleCancel = async (id: string) => {
    const now = Date.now();
    if (pendingCancelId !== id || now > pendingCancelUntil) {
      setPendingCancelId(id);
      setPendingCancelUntil(now + 6000);
      showToast({ type: 'warning', message: 'اضغط مرة أخرى لإلغاء الدفعة' });
      return;
    }
    setPendingCancelId(null);
    setPendingCancelUntil(0);
    try {
      await cancelImportBatch(id);
      showToast({ type: 'success', message: 'تم إلغاء الدفعة' });
      load(page);
    } catch (e: unknown) {
      showToast({ type: 'error', message: (e as { message?: string }).message ?? 'فشل الإلغاء' });
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">سجل استيرادات Excel</h2>
            <p className="text-slate-500 mt-1">{total} دفعة استيراد مسجلة</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load(page)} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
          <Link to="/purchases/import-excel" className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-bold">
            <Upload className="w-4 h-4" />
            استيراد جديد
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 font-bold text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-right py-3 px-4 font-bold text-slate-600">الملف</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">المورد</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">المستودع</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">رقم الفاتورة</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">تاريخ الفاتورة</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">الحالة</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">صفوف</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">صالح</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">تحذير</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">خطأ</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">أتواب مُنشأة</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">أمتار</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">تاريخ الرفع</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">تاريخ التأكيد</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={15} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    جاري التحميل...
                  </td>
                </tr>
              )}
              {!loading && batches.length === 0 && (
                <tr>
                  <td colSpan={15} className="py-16 text-center">
                    <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-400 font-bold">لا توجد استيرادات بعد</p>
                    <Link to="/purchases/import-excel" className="mt-3 inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-bold">
                      <Upload className="w-4 h-4" />
                      بدء الاستيراد
                    </Link>
                  </td>
                </tr>
              )}
              {!loading && batches.map(b => (
                <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div>
                        <p className="font-medium text-slate-800 max-w-[200px] truncate">{b.file_name}</p>
                        {b.sheet_name && <p className="text-xs text-slate-400">الشيت: {b.sheet_name}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-700">{b.supplier_name ?? '—'}</td>
                  <td className="py-3 px-4 text-slate-700">{b.warehouse_name ?? '—'}</td>
                  <td className="py-3 px-4 font-mono text-slate-600">{b.invoice_no ?? '—'}</td>
                  <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                    {b.invoice_date ? new Date(b.invoice_date).toLocaleDateString('ar-SA') : '—'}
                  </td>
                  <td className="py-3 px-4"><BatchStatusBadge status={b.status} /></td>
                  <td className="py-3 px-4 font-mono">{b.row_count}</td>
                  <td className="py-3 px-4">
                    <span className="text-emerald-700 font-bold">{b.valid_count}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-amber-700 font-bold">{b.warning_count}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={b.error_count > 0 ? 'text-rose-700 font-bold' : 'text-slate-400'}>{b.error_count}</span>
                  </td>
                  <td className="py-3 px-4">
                    {b.created_roll_count > 0 ? (
                      <span className="text-indigo-700 font-bold">{b.created_roll_count}</span>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">
                    {parseFloat(b.total_length_m).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(b.created_at).toLocaleDateString('ar-SA')}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                    {b.confirmed_at ? new Date(b.confirmed_at).toLocaleDateString('ar-SA') : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      {b.status === 'CONFIRMED' && (
                        <>
                          {!!b.created_purchase_invoice_id && (
                            <Link
                              to={`/invoices/statement/${b.created_purchase_invoice_id}`}
                              title="عرض فاتورة الشراء"
                              className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-700 transition"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>
                          )}
                          <Link
                            to="/inventory"
                            title="عرض الأتواب المستوردة"
                            className="p-1.5 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition"
                          >
                            <Package className="w-4 h-4" />
                          </Link>
                          <Link
                            to={`/inventory/labels?batchId=${b.id}`}
                            title="طباعة لصاقات الدفعة"
                            className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition"
                          >
                            <Tags className="w-4 h-4" />
                          </Link>
                        </>
                      )}
                      {(b.status === 'PREVIEW' || b.status === 'PREVIEWED' || b.status === 'VALIDATED') && (
                        <>
                          <Link
                            to={`/purchases/import-excel?batchId=${b.id}`}
                            title="استمرار المراجعة"
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition"
                          >
                            <Eye className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => handleCancel(b.id)}
                            title="إلغاء الدفعة"
                            className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {b.status === 'CANCELLED' && (
                        <span className="text-slate-300 text-xs">ملغى</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
            <span>إجمالي: {total} دفعة</span>
            <div className="flex gap-2">
              <button onClick={() => { setPage(p => p - 1); load(page - 1); }} disabled={page <= 1} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">السابق</button>
              <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 font-bold rounded-lg">{page}/{totalPages}</span>
              <button onClick={() => { setPage(p => p + 1); load(page + 1); }} disabled={page >= totalPages} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">التالي</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
