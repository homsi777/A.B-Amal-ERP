import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { Plus, Search, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import {
  listSalesInvoices,
  getSalesInvoice,
  confirmSalesInvoice,
  deleteSalesInvoice,
  voidSalesInvoice,
} from '../lib/api/salesInvoicesApi';
import { listCashboxes } from '../lib/api/cashboxesApi';
import { displayStoredInvoiceNo, mapSalesListRowToInvoice, type ListedSaleInvoice } from '../lib/invoiceDbMappers';
import { arInvoicePaymentStatusCode, arDocumentStatus } from '../lib/i18n/arTerminology';
import { WHOLESALE_SALES_MODE } from '../lib/inventoryUiConfig';
import { useToast } from '../components/NonBlockingToast';
import { ApiRequestError } from '../lib/api/client';

type DocFilter = '' | 'DRAFT' | 'CONFIRMED' | 'VOIDED';

export const Sales = () => {
  const { showToast } = useToast();
  const { customers } = useStore();
  const [salesInvoices, setSalesInvoices] = useState<ListedSaleInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [documentStatus, setDocumentStatus] = useState<DocFilter>('');
  const [cashboxOptions, setCashboxOptions] = useState<{ id: string; name: string; code: string }[]>([]);
  const [confirmCashboxId, setConfirmCashboxId] = useState('');
  const [confirmTargetId, setConfirmTargetId] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listSalesInvoices({
        search: search.trim() || undefined,
        pageSize: 200,
        documentStatus: documentStatus || undefined,
      });
      setSalesInvoices(res.rows.map((row) => mapSalesListRowToInvoice(row as Record<string, unknown>)));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'تعذر تحميل الفواتير');
      setSalesInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [search, documentStatus]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void refresh();
    }, 320);
    return () => window.clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    void listCashboxes({ active: true })
      .then((res) => {
        setCashboxOptions(
          res.data.map((box) => ({
            id: box.id,
            name: box.name,
            code: box.code,
          })),
        );
      })
      .catch(() => setCashboxOptions([]));
  }, []);

  const payStatus = (inv: ListedSaleInvoice) => inv.paymentStatus ?? inv.status;

  const runConfirm = async (id: string, cashboxId?: string | null) => {
    await confirmSalesInvoice(id, cashboxId ? { cashboxId } : {});
    showToast({
      type: 'success',
      message: WHOLESALE_SALES_MODE
        ? 'تم تأكيد الفاتورة — التأكيد النهائي يتم من قسم التسليم بعد التفنيد'
        : 'تم تأكيد فاتورة المبيعات',
    });
    setConfirmTargetId(null);
    setConfirmCashboxId('');
    void refresh();
  };

  const handleConfirm = async (id: string) => {
    if (
      !window.confirm(
        WHOLESALE_SALES_MODE
          ? 'سيتم تأكيد الفاتورة وإرسالها لقسم التسليم. لن يُخصم المخزون حتى يفنّد أمين المستودع ويوافق المدير. هل تريد المتابعة؟'
          : 'سيتم ترحيل الفاتورة وسيؤثر ذلك على المخزون والحسابات، هل أنت متأكد؟',
      )
    ) {
      return;
    }
    setConfirmBusy(true);
    try {
      const detail = await getSalesInvoice(id);
      const paid = Number(detail.data.header.paid_amount ?? 0) || 0;
      if (paid > 1e-4) {
        setConfirmTargetId(id);
        if (confirmCashboxId) {
          await runConfirm(id, confirmCashboxId);
        } else {
          showToast({
            type: 'warning',
            message: 'اختر الصندوق المالي لربط الدفعة بخزينة حقيقية وتوليد السند تلقائياً على الخادم.',
          });
        }
        return;
      }
      await runConfirm(id);
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر تأكيد الفاتورة',
      });
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleConfirmWithCashbox = async () => {
    if (!confirmTargetId) return;
    if (!confirmCashboxId) {
      showToast({
        type: 'warning',
        message: 'اختر الصندوق المالي لربط الدفعة بخزينة حقيقية وتوليد السند تلقائياً على الخادم.',
      });
      return;
    }
    setConfirmBusy(true);
    try {
      await runConfirm(confirmTargetId, confirmCashboxId);
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر تأكيد الفاتورة',
      });
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleDeleteDraft = async (id: string) => {
    if (
      !window.confirm(
        'سيتم حذف المسودة فقط ولن يؤثر ذلك على المخزون أو الحسابات. هل تريد المتابعة؟',
      )
    ) {
      return;
    }
    try {
      await deleteSalesInvoice(id);
      showToast({ type: 'success', message: 'تم حذف المسودة' });
      void refresh();
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر حذف المسودة',
      });
    }
  };

  const handleVoid = async (id: string) => {
    if (
      !window.confirm(
        'سيتم إلغاء الفاتورة المؤكدة وعكس أثرها على المخزون والقيود المحاسبية قدر الإمكان. هل أنت متأكد؟',
      )
    ) {
      return;
    }
    try {
      await voidSalesInvoice(id);
      showToast({ type: 'success', message: 'تم إلغاء الفاتورة' });
      void refresh();
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر إلغاء الفاتورة',
      });
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">المبيعات</h2>
          <p className="text-slate-500 mt-1">
            إدارة فواتير المبيعات
            {WHOLESALE_SALES_MODE ? ' — المسودة تُرسل تلقائياً لقسم التسليم' : ''}
          </p>
        </div>
        <Link
          to="/invoices/sales/new"
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" />
          <span>فاتورة مبيعات جديدة</span>
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="بحث برقم الفاتورة، أو اسم العميل..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-lg shadow-sm">
            <Filter className="w-4 h-4 text-slate-500" />
            <label className="text-sm font-bold text-slate-700 whitespace-nowrap">حالة المستند</label>
            <select
              value={documentStatus}
              onChange={(e) => setDocumentStatus(e.target.value as DocFilter)}
              className="text-sm font-medium text-slate-800 bg-transparent border-none outline-none cursor-pointer"
            >
              <option value="">الكل</option>
              <option value="DRAFT">مسودة</option>
              <option value="CONFIRMED">مؤكدة</option>
              <option value="VOIDED">ملغاة</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          {loadError && (
            <div className="px-6 py-3 text-sm text-rose-700 bg-rose-50 border-b border-rose-100">{loadError}</div>
          )}
          {loading && !loadError ? (
            <div className="px-6 py-12 text-center text-slate-500">جاري تحميل الفواتير...</div>
          ) : (
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">رقم الفاتورة</th>
                  <th className="px-6 py-4">التاريخ</th>
                  <th className="px-6 py-4">العميل</th>
                  <th className="px-6 py-4">الإجمالي ($)</th>
                  <th className="px-6 py-4">المدفوع ($)</th>
                  <th className="px-6 py-4">المتبقي ($)</th>
                  <th className="px-6 py-4">حالة المستند</th>
                  <th className="px-6 py-4">حالة الدفع</th>
                  <th className="px-6 py-4">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {salesInvoices.map((invoice) => {
                  const customer = customers.find((c) => c.id === invoice.partyId);
                  const partyName = invoice.partyLabel || customer?.name || '-';
                  const doc = invoice.documentStatus ?? '';
                  const ps = payStatus(invoice);
                  return (
                    <tr key={invoice.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-mono font-medium text-indigo-600">
                        {displayStoredInvoiceNo(invoice.invoiceNumber)}
                      </td>
                      <td className="px-6 py-4 text-slate-500 font-medium">
                        {format(new Date(invoice.date), 'PP', { locale: ar })}
                      </td>
                      <td className="px-6 py-4 text-slate-700 font-bold">{partyName}</td>
                      <td className="px-6 py-4 font-semibold text-slate-900">{invoice.totalAmount.toFixed(2)}</td>
                      <td className="px-6 py-4 font-semibold text-emerald-600">{invoice.paidAmount.toFixed(2)}</td>
                      <td className="px-6 py-4 font-semibold text-rose-600">{invoice.remainingAmount.toFixed(2)}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${
                            doc === 'DRAFT'
                              ? 'bg-amber-100 text-amber-800'
                              : doc === 'CONFIRMED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : doc === 'VOIDED'
                                  ? 'bg-slate-200 text-slate-700'
                                  : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {arDocumentStatus(doc)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${
                            ps === 'paid'
                              ? 'bg-emerald-100 text-emerald-700'
                              : ps === 'partial'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {arInvoicePaymentStatusCode(ps)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          {doc === 'DRAFT' ? (
                            <>
                              <Link
                                to={`/invoices/sales/${invoice.id}/edit`}
                                className="text-amber-800 hover:text-amber-950 font-medium bg-amber-50 px-2 py-1 rounded-lg hover:bg-amber-100 transition text-xs"
                              >
                                متابعة المسودة
                              </Link>
                              {!WHOLESALE_SALES_MODE ? (
                                <button
                                  type="button"
                                  disabled={confirmBusy}
                                  onClick={() => void handleConfirm(invoice.id)}
                                  className="text-white font-medium bg-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-700 transition text-xs disabled:opacity-50"
                                >
                                  تأكيد
                                </button>
                              ) : (
                                <Link
                                  to="/delivery"
                                  className="text-sky-800 font-medium bg-sky-50 px-2 py-1 rounded-lg hover:bg-sky-100 transition text-xs"
                                >
                                  في التسليم
                                </Link>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleDeleteDraft(invoice.id)}
                                className="text-rose-800 font-medium bg-rose-50 px-2 py-1 rounded-lg hover:bg-rose-100 transition text-xs"
                              >
                                حذف المسودة
                              </button>
                            </>
                          ) : null}
                          {doc === 'CONFIRMED' || doc === 'VOIDED' ? (
                            <Link
                              to={`/invoices/statement/${invoice.id}`}
                              className="text-indigo-600 hover:text-indigo-800 font-medium bg-indigo-50 px-2 py-1 rounded-lg hover:bg-indigo-100 transition text-xs"
                            >
                              كشف الفاتورة
                            </Link>
                          ) : null}
                          {doc === 'CONFIRMED' ? (
                            <button
                              type="button"
                              onClick={() => void handleVoid(invoice.id)}
                              className="text-slate-800 font-medium bg-slate-100 px-2 py-1 rounded-lg hover:bg-slate-200 transition text-xs"
                            >
                              إلغاء
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {salesInvoices.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                      لا يوجد فواتير مبيعات في الخادم ضمن البحث الحالي.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {confirmTargetId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4" dir="rtl">
            <h3 className="text-lg font-bold text-slate-900">اختيار صندوق مالي للدفعة</h3>
            <p className="text-sm text-slate-600">
              الفاتورة تحتوي دفعة نقدية. اختر الصندوق لربط القبض وتوليد السند تلقائياً عند التأكيد.
            </p>
            <select
              value={confirmCashboxId}
              onChange={(e) => setConfirmCashboxId(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:border-indigo-500"
            >
              <option value="">-- اختر الصندوق --</option>
              {cashboxOptions.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name} ({box.code})
                </option>
              ))}
            </select>
            {cashboxOptions.length === 0 && (
              <p className="text-xs text-amber-700">لا صناديق من الخادم — أنشئ صندوقاً من إعدادات الخزينة.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setConfirmTargetId(null);
                  setConfirmCashboxId('');
                }}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => void handleConfirmWithCashbox()}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
              >
                تأكيد الفاتورة
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
