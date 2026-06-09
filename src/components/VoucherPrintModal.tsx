import React from 'react';
import { Download, Printer, X, Loader2 } from 'lucide-react';
import type { VoucherRow } from '../lib/api/vouchersApi';
import { useToast } from './NonBlockingToast';
import { renderVoucherA5Html } from '../lib/pdfExport';

interface VoucherPrintModalProps {
  isOpen: boolean;
  voucher: VoucherRow | null;
  onClose: () => void;
  onPrint?: () => Promise<void>;
  onExportPdf?: () => Promise<void>;
}

export const VoucherPrintModal: React.FC<VoucherPrintModalProps> = ({
  isOpen,
  voucher,
  onClose,
  onPrint,
  onExportPdf,
}) => {
  const { showToast } = useToast();
  const [printing, setPrinting] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  if (!isOpen || !voucher) return null;

  const handlePrint = async () => {
    if (onPrint) {
      setPrinting(true);
      try {
        await onPrint();
      } finally {
        setPrinting(false);
      }
      return;
    }

    // Default print handler for Electron
    setPrinting(true);
    try {
      const voucherHtml = renderVoucherA5Html({
        voucherNo: voucher.voucher_no,
        voucherType: voucher.voucher_type,
        voucherDate: voucher.voucher_date,
        partyName: voucher.party_name,
        partyType: voucher.party_type ?? undefined,
        amount: voucher.amount,
        currencyCode: voucher.currency_code,
        exchangeRateToUsd: voucher.exchange_rate_to_usd ?? undefined,
        amountUsd: voucher.amount_usd ?? undefined,
        cashboxName: voucher.cashbox_name ?? undefined,
        description: voucher.description,
      });

      const typeLabel = voucher.voucher_type === 'RECEIPT' ? 'قبض' : 'صرف';
      if (window.fabricApp?.printHtml) {
        const settings = await window.fabricApp.getSettings();
        const result = await window.fabricApp.printHtml(voucherHtml, {
          pageSize: 'A5',
          silent: Boolean(settings.silentA4PrintingEnabled),
          printerName: settings.defaultA4PrinterName ?? undefined,
          printBackground: true,
        });
        if (result.ok) {
          showToast({ type: 'success', message: 'تم إرسال السند إلى الطابعة بنجاح' });
          onClose();
        } else {
          showToast({ type: 'error', message: `خطأ في الطباعة: ${result.error || 'خطأ غير معروف'}` });
        }
      } else {
        const printWindow = window.open('', '_blank', 'width=800,height=900');
        if (!printWindow) {
          showToast({ type: 'error', message: 'الرجاء السماح بالنوافذ المنبثقة ثم أعد المحاولة' });
          return;
        }
        printWindow.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>سند ${typeLabel}</title><style>@page { size: 148mm 210mm; margin: 0; } * { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: Arial, sans-serif; direction: rtl; }</style></head><body>${voucherHtml}</body></html>`);
        printWindow.document.close();
        printWindow.onload = () => { setTimeout(() => { printWindow.print(); }, 500); };
        showToast({ type: 'success', message: 'تم فتح نافذة الطباعة' });
        onClose();
      }
    } catch (error) {
      showToast({ type: 'error', message: `خطأ في الطباعة: ${error instanceof Error ? error.message : 'خطأ غير معروف'}` });
    } finally {
      setPrinting(false);
    }
  };

  const handleExportPdf = async () => {
    if (onExportPdf) {
      setExporting(true);
      try {
        await onExportPdf();
      } finally {
        setExporting(false);
      }
      return;
    }

    // Default PDF export handler for Electron
    setExporting(true);
    try {
      const normalizedDate = String(voucher.voucher_date ?? '').trim() || new Date().toISOString().slice(0, 10);
      const normalizedPartyName = String(voucher.party_name ?? '').trim() || 'بدون اسم';
      const normalizedAmount = String(voucher.amount ?? '0');
      const normalizedCurrency = String(voucher.currency_code ?? 'USD');
      const normalizedType = voucher.voucher_type === 'RECEIPT' ? 'RECEIPT' : 'PAYMENT';
      const voucherHtml = renderVoucherA5Html({
        voucherNo: String(voucher.voucher_no ?? '—'),
        voucherType: normalizedType,
        voucherDate: normalizedDate,
        partyName: normalizedPartyName,
        partyType: voucher.party_type ?? undefined,
        amount: normalizedAmount,
        currencyCode: normalizedCurrency,
        exchangeRateToUsd: voucher.exchange_rate_to_usd ?? undefined,
        amountUsd: voucher.amount_usd ?? undefined,
        cashboxName: voucher.cashbox_name ?? undefined,
        description: voucher.description,
      });

      const typeLabel = normalizedType === 'RECEIPT' ? 'قبض' : 'صرف';
      const safeDate = normalizedDate
        .split('T')[0]
        .replace(/\//g, '-')
        .replace(/:/g, '-')
        .replace(/\\/g, '-')
        .trim();
      const safeName = normalizedPartyName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'بدون_اسم';
      const fileName = `سند_${typeLabel}_${safeName}_${safeDate}`;

      if (window.fabricApp?.printToPdf) {
        const result = await window.fabricApp.printToPdf(voucherHtml, {
          pageSize: 'A5',
          defaultFileName: fileName,
        });
        if (result.ok) {
          showToast({ type: 'success', message: `تم حفظ السند في: ${result.filePath}` });
          onClose();
        } else {
          showToast({ type: 'error', message: `خطأ في التصدير: ${result.error || 'تم إلغاء العملية'}` });
        }
      } else {
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.width = '1200px';
        container.style.backgroundColor = '#ffffff';
        container.style.color = '#0f172a';
        container.style.direction = 'rtl';
        container.innerHTML = voucherHtml;
        document.body.appendChild(container);
        try {
          const { default: html2canvas } = await import('html2canvas');
          const { default: jsPDF } = await import('jspdf');
          const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
          const imgData = canvas.toDataURL('image/jpeg', 0.9);
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
          const pageWidth = pdf.internal.pageSize.getWidth();
          const pageHeight = pdf.internal.pageSize.getHeight();
          const imgWidth = pageWidth;
          const imgHeight = (canvas.height * imgWidth) / canvas.width;
          const y = Math.max(0, (pageHeight - imgHeight) / 2);
          pdf.addImage(imgData, 'JPEG', 0, y, imgWidth, imgHeight);
          pdf.save(`${fileName}.pdf`);
          showToast({ type: 'success', message: 'تم تصدير السند كـ PDF بنجاح' });
          onClose();
        } catch {
          showToast({ type: 'error', message: 'تعذر تصدير PDF. تأكد من السماح بالنوافذ المنبثقة.' });
        } finally {
          document.body.removeChild(container);
        }
      }
    } catch (error) {
      showToast({ type: 'error', message: `خطأ في التصدير: ${error instanceof Error ? error.message : 'خطأ غير معروف'}` });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-6 text-right animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">السند #{voucher.voucher_no}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900">
            ✓ تم حفظ السند بنجاح في الصندوق. اختر ما تريد فعله الآن:
          </p>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            disabled={printing || exporting}
            onClick={() => void handlePrint()}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition disabled:opacity-60 flex items-center justify-center gap-2 font-medium"
          >
            {printing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري الطباعة...
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                طباعة A5
              </>
            )}
          </button>

          <button
            type="button"
            disabled={printing || exporting}
            onClick={() => void handleExportPdf()}
            className="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition disabled:opacity-60 flex items-center justify-center gap-2 font-medium"
          >
            {exporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري التصدير...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                تصدير PDF
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={printing || exporting}
            className="w-full bg-slate-200 text-slate-900 py-2.5 rounded-lg hover:bg-slate-300 transition disabled:opacity-60 font-medium"
          >
            إغلاق
          </button>
        </div>

        <div className="text-xs text-slate-500 bg-slate-50 rounded p-3 text-right">
          📝 <strong>المعلومات:</strong>
          <br />
          النوع: {voucher.voucher_type === 'RECEIPT' ? 'قبض' : 'صرف'}
          <br />
          التاريخ: {voucher.voucher_date}
          <br />
          المبلغ: {Number(voucher.amount).toLocaleString('ar')} {voucher.currency_code}
        </div>
      </div>
    </div>
  );
};
