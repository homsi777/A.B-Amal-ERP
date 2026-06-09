import React, { useCallback, useMemo, useState } from 'react';
import {
  Building2,
  Calendar,
  FileSpreadsheet,
  FileText,
  MessageCircle,
  Printer,
  User,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import type { Customer, CustomerOrder } from '../../types';
import {
  buildCustomerOrderWhatsAppText,
  exportCustomerOrderExcel,
  exportCustomerOrderPdf,
  orderGrandTotal,
  orderLineTotal,
  orderTotalLength,
  orderTotalWeight,
} from '../../lib/orderExport';
import { ORDER_STATUS_LABELS, statusBadgeClass } from '../../pages/orders/orderStatusUi';

export interface OrderDetailModalProps {
  open: boolean;
  order: CustomerOrder | null;
  customer: Customer | undefined;
  onClose: () => void;
}

const FALLBACK_CUSTOMER: Customer = {
  id: '—',
  name: 'عميل غير معروف',
  phone: '—',
  address: '—',
  balance: 0,
};

export function OrderDetailModal({ open, order, customer, onClose }: OrderDetailModalProps) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const party = customer ?? FALLBACK_CUSTOMER;
  const statusLabel = order ? ORDER_STATUS_LABELS[order.status] : '';

  const grandTotal = useMemo(() => (order ? orderGrandTotal(order) : 0), [order]);
  const totalLength = useMemo(() => (order ? orderTotalLength(order) : 0), [order]);
  const totalWeight = useMemo(() => (order ? orderTotalWeight(order) : 0), [order]);

  const handlePdf = useCallback(async () => {
    if (!order) return;
    setPdfBusy(true);
    try {
      await exportCustomerOrderPdf(order, party, statusLabel);
    } finally {
      setPdfBusy(false);
    }
  }, [order, party, statusLabel]);

  const handleExcel = useCallback(() => {
    if (!order) return;
    exportCustomerOrderExcel(order, party, statusLabel);
  }, [order, party, statusLabel]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleWhatsApp = useCallback(() => {
    if (!order) return;
    const text = buildCustomerOrderWhatsAppText(order, party, statusLabel);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }, [order, party, statusLabel]);

  if (!open || !order) return null;

  const warehouseLabel = order.warehouse === 'sub' ? 'مستودع الجملة' : 'المستودع الرئيسي';

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #order-detail-print-root, #order-detail-print-root * { visibility: visible !important; }
          #order-detail-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 12mm !important;
            background: #fff !important;
            box-shadow: none !important;
          }
          #order-detail-print-root table { font-size: 10px !important; }
        }
      `}</style>

      <div
        className="fixed inset-0 z-[205] flex items-stretch justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-[2px] print:hidden"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
        onClick={onClose}
      >
        <div
          className="relative flex min-h-0 w-full max-w-[1100px] flex-1 flex-col max-h-[calc(100dvh-1rem)] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden mx-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* شريط أدوات — لا يُطبع */}
          <div className="flex flex-wrap items-center gap-2 justify-between px-4 py-3 border-b border-slate-200 bg-gradient-to-l from-indigo-50/90 to-white shrink-0">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pdfBusy}
                onClick={handlePdf}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 disabled:opacity-60"
              >
                <FileText className="w-4 h-4 shrink-0" />
                {pdfBusy ? 'جاري PDF…' : 'PDF'}
              </button>
              <button
                type="button"
                onClick={handleExcel}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                Excel
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold bg-slate-100 text-slate-800 border border-slate-200 hover:bg-slate-200"
              >
                <Printer className="w-4 h-4 shrink-0" />
                طباعة
              </button>
              <button
                type="button"
                onClick={handleWhatsApp}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold bg-[#25D366]/15 text-emerald-900 border border-emerald-300/60 hover:bg-[#25D366]/25"
              >
                <MessageCircle className="w-4 h-4 shrink-0" />
                واتساب
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 border border-transparent hover:border-slate-200"
            >
              <X className="w-5 h-5" />
              إغلاق
            </button>
          </div>

          <div id="order-detail-print-root" className="flex-1 overflow-y-auto min-h-0 p-5 sm:p-8 bg-slate-50/80">
            <div className="max-w-[980px] mx-auto space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-200 pb-6">
                <div>
                  <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide">طلبية حجز — معاينة نهائية</p>
                  <h2 id="order-detail-title" className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 font-mono">
                    {order.orderNumber}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">Tex Matrix ERP · مستودعات الأقمشة</p>
                </div>
                <div className={`rounded-xl px-4 py-2 text-sm font-bold inline-flex items-center gap-2 ${statusBadgeClass(order.status)}`}>
                  {statusLabel}
                </div>
              </header>

              <section className="grid sm:grid-cols-2 gap-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex gap-3">
                  <div className="shrink-0 w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center">
                    <User className="w-6 h-6 text-indigo-700" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-500">العميل</div>
                    <div className="font-bold text-slate-900 text-lg">{party.name}</div>
                    <div className="text-sm text-slate-600 mt-0.5" dir="ltr">
                      {party.phone}
                    </div>
                    <div className="text-sm text-slate-600 mt-1">{party.address}</div>
                  </div>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-bold text-slate-600">تاريخ الطلب:</span>
                    <span>{format(new Date(order.date), 'PPP', { locale: ar })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-700">
                    <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-bold text-slate-600">المستودع:</span>
                    <span>{warehouseLabel}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      <span className="font-bold text-slate-600">العملة:</span>{' '}
                      <span className="font-mono">{order.currency}</span>
                    </span>
                    <span>
                      <span className="font-bold text-slate-600">متوقع التوريد:</span>{' '}
                      {order.expectedDate ? format(new Date(order.expectedDate), 'PP', { locale: ar }) : '—'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 pt-1 border-t border-slate-100">
                    أنشئت {format(new Date(order.createdAt), 'PPp', { locale: ar })} · حُدِّثت{' '}
                    {format(new Date(order.updatedAt), 'PPp', { locale: ar })}
                  </div>
                </div>
              </section>

              {order.notes?.trim() && (
                <section className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 text-sm text-amber-950">
                  <span className="font-bold">ملاحظات:</span> {order.notes}
                </section>
              )}

              <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm">
                  <div className="text-xs font-bold text-slate-500">إجمالي الخامات</div>
                  <div className="text-2xl font-black text-indigo-600 mt-1">{order.items.length}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">عدد البنود</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm">
                  <div className="text-xs font-bold text-slate-500">إجمالي الطول</div>
                  <div className="text-2xl font-black text-sky-600 mt-1">{totalLength.toFixed(2)}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">كمية مجمّعة</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm">
                  <div className="text-xs font-bold text-slate-500">إجمالي الوزن</div>
                  <div className="text-2xl font-black text-blue-700 mt-1">{totalWeight.toFixed(2)}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">كجم</div>
                </div>
                <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-xl border border-indigo-400 p-4 text-center text-white shadow-lg">
                  <div className="text-xs font-bold text-indigo-100">إجمالي السعر</div>
                  <div className="text-2xl font-black mt-1">
                    {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                    <span className="text-sm font-semibold opacity-90">{order.currency}</span>
                  </div>
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-slate-800 text-white text-sm font-bold">بنود الطلبية</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right min-w-[720px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 text-xs font-bold border-b border-slate-200">
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2 w-16">صورة</th>
                        <th className="px-3 py-2">مرجع</th>
                        <th className="px-3 py-2">خامة</th>
                        <th className="px-3 py-2 font-mono">كود</th>
                        <th className="px-3 py-2">لون</th>
                        <th className="px-3 py-2">كمية</th>
                        <th className="px-3 py-2">سعر</th>
                        <th className="px-3 py-2">إجمالي</th>
                        <th className="px-3 py-2">وزن</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {order.items.map((line, idx) => (
                        <tr key={line.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                          <td className="px-3 py-2 text-center font-mono text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2 align-middle">
                            {line.imageUrl ? (
                              <img
                                src={line.imageUrl}
                                alt=""
                                crossOrigin="anonymous"
                                referrerPolicy="no-referrer"
                                className="w-11 h-11 object-cover rounded-lg border border-slate-200 mx-auto"
                              />
                            ) : (
                              <span className="text-slate-300 flex justify-center">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{line.referenceBarcode || '—'}</td>
                          <td className="px-3 py-2 font-medium text-slate-900">{line.materialName}</td>
                          <td className="px-3 py-2 font-mono text-xs">{line.dsamNumber}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1">
                              <span
                                className="inline-block w-3 h-3 rounded-full border border-slate-300 shrink-0"
                                style={{ backgroundColor: line.colorCode || '#ccc' }}
                                title={line.colorCode}
                              />
                              <span>{line.colorName}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono">{line.length.toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono">{line.price.toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono font-bold text-indigo-700">
                            {orderLineTotal(line).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 font-mono">{line.weight.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <footer className="text-center text-xs text-slate-400 pb-4">
                معاينة المستند — يمكن تصديره أو مشاركته عبر الأزرار أعلاه.
              </footer>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
