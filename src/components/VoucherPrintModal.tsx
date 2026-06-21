import React, { useMemo } from 'react';
import { Download, Printer, X, Loader2 } from 'lucide-react';
import type { VoucherRow } from '../lib/api/vouchersApi';
import { useToast } from './NonBlockingToast';
import {
  exportVoucherToPdf,
  renderVoucherA5Html,
  voucherRowToPrintData,
  type VoucherRenderOptions,
} from '../lib/pdfExport';
import { buildVoucherNarrativeParagraph } from '../lib/printing/voucherNarrative';

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
  const [bwPrint, setBwPrint] = React.useState(false);

  const printData = useMemo(() => (voucher ? voucherRowToPrintData(voucher) : null), [voucher]);

  const narrativePreview = useMemo(() => {
    if (!printData) return '';
    return buildVoucherNarrativeParagraph({
      voucherType: printData.voucherType,
      partyName: printData.partyName,
      amount: Number(printData.amount) || 0,
      currencyCode: printData.currencyCode,
      paymentMethod: printData.paymentMethod,
      cashboxName: printData.cashboxName,
      referenceDocumentNo: printData.referenceDocumentNo,
      description: printData.description,
    });
  }, [printData]);

  const renderOptions: VoucherRenderOptions = useMemo(
    () => ({ colorMode: bwPrint ? 'bw' : 'color' }),
    [bwPrint],
  );

  if (!isOpen || !voucher || !printData) return null;

  const buildHtml = () => renderVoucherA5Html(printData, renderOptions);

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

    setPrinting(true);
    try {
      const voucherHtml = buildHtml();
      const typeLabel = voucher.voucher_type === 'RECEIPT' ? 'قبض' : 'صرف';
      if (window.fabricApp?.printHtml) {
        const settings = await window.fabricApp.getSettings();
        const result = await window.fabricApp.printHtml(voucherHtml, {
          pageSize: 'A5',
          silent: Boolean(settings.silentA4PrintingEnabled),
          printerName: settings.defaultA4PrinterName ?? undefined,
          printBackground: !bwPrint,
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
        printWindow.document.write(voucherHtml);
        printWindow.document.close();
        printWindow.onload = () => {
          setTimeout(() => {
            printWindow.print();
          }, 500);
        };
        showToast({ type: 'success', message: 'تم فتح نافذة الطباعة' });
        onClose();
      }
    } catch (error) {
      showToast({
        type: 'error',
        message: `خطأ في الطباعة: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`,
      });
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

    setExporting(true);
    try {
      const normalizedDate = String(voucher.voucher_date ?? '').trim() || new Date().toISOString().slice(0, 10);
      const normalizedPartyName = String(voucher.party_name ?? '').trim() || 'بدون اسم';
      const typeLabel = voucher.voucher_type === 'RECEIPT' ? 'قبض' : 'صرف';
      const safeDate = normalizedDate
        .split('T')[0]
        .replace(/\//g, '-')
        .replace(/:/g, '-')
        .replace(/\\/g, '-')
        .trim();
      const safeName = normalizedPartyName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'بدون_اسم';
      const fileName = `سند_${typeLabel}_${safeName}_${safeDate}`;

      if (window.fabricApp?.printToPdf) {
        const result = await window.fabricApp.printToPdf(buildHtml(), {
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
        await exportVoucherToPdf(printData, fileName, renderOptions);
        showToast({ type: 'success', message: 'تم تصدير السند كـ PDF بنجاح' });
        onClose();
      }
    } catch (error) {
      showToast({
        type: 'error',
        message: `خطأ في التصدير: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-5 text-right animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">السند #{voucher.voucher_no}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <p className="text-sm text-emerald-900 font-bold mb-2">نص البيان على السند (A5):</p>
          <p className="text-sm text-slate-800 leading-relaxed">{narrativePreview}</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={bwPrint}
            onChange={(e) => setBwPrint(e.target.checked)}
            className="rounded border-slate-300"
          />
          طباعة أبيض وأسود (توفير الحبر)
        </label>

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
