import React, { useCallback, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, MessageCircle, Printer, X } from 'lucide-react';
import type { Customer, CustomerOrder } from '../../types';
import {
  buildCustomerOrderWhatsAppText,
  exportCustomerOrderExcel,
  exportCustomerOrderPdf,
  printCustomerOrderDocument,
} from '../../lib/orderExport';
import { renderReservationOrderA4Document } from '../../lib/printing/renderReservationOrderA4';
import { ORDER_STATUS_LABELS } from '../../pages/orders/orderStatusUi';
import { useToast } from '../NonBlockingToast';
import { TelegramSendButton } from '../telegram/TelegramSendButton';
import { sendTelegramCustomerOrder } from '../../lib/telegramOrder';

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
  const { showToast } = useToast();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const party = customer ?? FALLBACK_CUSTOMER;
  const statusLabel = order ? ORDER_STATUS_LABELS[order.status] : '';

  const previewSrcDoc = useMemo(
    () => (order ? renderReservationOrderA4Document(order, party, statusLabel) : ''),
    [order, party, statusLabel],
  );

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

  const handlePrint = useCallback(async () => {
    if (!order) return;
    setPrintBusy(true);
    try {
      const result = await printCustomerOrderDocument(order, party, statusLabel);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error || 'تعذرت الطباعة' });
        return;
      }
      showToast({ type: 'success', message: 'تم فتح نافذة الطباعة' });
    } finally {
      setPrintBusy(false);
    }
  }, [order, party, statusLabel, showToast]);

  const handleWhatsApp = useCallback(() => {
    if (!order) return;
    const text = buildCustomerOrderWhatsAppText(order, party, statusLabel);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }, [order, party, statusLabel]);

  const handleTelegram = useCallback(async () => {
    if (!order) return;
    setTelegramBusy(true);
    try {
      await sendTelegramCustomerOrder(order, party, statusLabel);
      showToast({ type: 'success', message: 'تم إرسال الطلبية إلى تيليغرام.' });
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'تعذر إرسال الطلبية إلى تيليغرام',
      });
    } finally {
      setTelegramBusy(false);
    }
  }, [order, party, statusLabel, showToast]);

  if (!open || !order) return null;

  return (
    <div
      className="fixed inset-0 z-[205] flex items-stretch justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-[2px]"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-detail-title"
      onClick={onClose}
    >
      <div
        className="relative flex min-h-0 w-full max-w-[980px] flex-1 flex-col max-h-[calc(100dvh-1rem)] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden mx-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 justify-between px-4 py-3 border-b border-slate-200 bg-gradient-to-l from-[#2C405A]/10 to-white shrink-0">
          <div className="min-w-0">
            <p id="order-detail-title" className="text-xs font-bold text-[#2C405A] uppercase tracking-wide">
              أوردر — معاينة المستند
            </p>
            <p className="text-lg font-black text-slate-900 font-mono truncate">{order.orderNumber}</p>
          </div>
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
              disabled={printBusy}
              onClick={() => void handlePrint()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold bg-slate-100 text-slate-800 border border-slate-200 hover:bg-slate-200 disabled:opacity-60"
            >
              <Printer className="w-4 h-4 shrink-0" />
              {printBusy ? 'جاري الطباعة…' : 'طباعة'}
            </button>
            <button
              type="button"
              onClick={handleWhatsApp}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold bg-[#25D366]/15 text-emerald-900 border border-emerald-300/60 hover:bg-[#25D366]/25"
            >
              <MessageCircle className="w-4 h-4 shrink-0" />
              واتساب
            </button>
            <TelegramSendButton
              size="toolbar"
              label="إرسال تيليغرام"
              busy={telegramBusy}
              onClick={handleTelegram}
              className="rounded-xl"
            />
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 border border-transparent hover:border-slate-200"
            >
              <X className="w-5 h-5" />
              إغلاق
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden min-h-0 bg-slate-100">
          <iframe
            title="معاينة طلبية الحجز"
            srcDoc={previewSrcDoc}
            className="w-full h-full border-0 bg-slate-100"
          />
        </div>
      </div>
    </div>
  );
}
