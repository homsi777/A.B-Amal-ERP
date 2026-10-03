import React, { useMemo } from 'react';
import { Download, Printer, X, Loader2 } from 'lucide-react';
import type { VoucherRow } from '../lib/api/vouchersApi';
import { useToast } from './NonBlockingToast';
import { buildVoucherFileName, pdfFileStem } from '../lib/printing/documentFileNames';
import { exportPrintHtmlToPdf, openDocumentPrintWindow } from '../lib/printing/documentPrint';
import {
  ELECTRON_A5_EMBEDDED_MARGINS,
  renderVoucherA5Html,
  voucherRowToPrintData,
  type VoucherRenderOptions,
} from '../lib/pdfExport';
import { buildVoucherNarrativeParagraph } from '../lib/printing/voucherNarrative';
import i18n from '../i18n/config';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'terminology', ...options });

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
      purpose: printData.purpose,
      description: printData.description,
    });
  }, [printData]);

  const renderOptions: VoucherRenderOptions = useMemo(
    () => ({ colorMode: 'color' }),
    [],
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
      const typeLabel = voucher.voucher_type === 'RECEIPT' ? t('voucher.typeReceipt') : t('voucher.typePayment');
      if (window.fabricApp?.printHtml) {
        const settings = await window.fabricApp.getSettings();
        const result = await window.fabricApp.printHtml(voucherHtml, {
          pageSize: 'A5',
          silent: Boolean(settings.silentA4PrintingEnabled),
          printerName: settings.defaultA4PrinterName ?? undefined,
          printBackground: true,
        });
        if (result.ok) {
          showToast({ type: 'success', message: t('voucherPrintModal.printedToPrinterSuccess') });
          onClose();
        } else {
          showToast({ type: 'error', message: t('voucherPrintModal.printError', { error: result.error || t('voucherPrintModal.unknownError') }) });
        }
      } else {
        if (!openDocumentPrintWindow(voucherHtml, t('voucherPrintModal.docTitle', { type: typeLabel }))) {
          showToast({ type: 'error', message: t('voucherPrintModal.allowPopups') });
          return;
        }
        showToast({ type: 'success', message: t('voucherPrintModal.printWindowOpened') });
        onClose();
      }
    } catch (error) {
      showToast({
        type: 'error',
        message: t('voucherPrintModal.printError', { error: error instanceof Error ? error.message : t('voucherPrintModal.unknownError') }),
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
      const fileName = buildVoucherFileName(
        voucher.voucher_type,
        String(voucher.party_name ?? '').trim() || t('voucherPrintModal.noNameFallback'),
        String(voucher.voucher_no ?? voucher.id),
      );

      if (window.fabricApp?.printToPdf) {
        const result = await window.fabricApp.printToPdf(buildHtml(), {
          pageSize: 'A5',
          defaultFileName: pdfFileStem(fileName),
          margins: { ...ELECTRON_A5_EMBEDDED_MARGINS },
        });
        if (result.ok) {
          showToast({ type: 'success', message: t('voucherPrintModal.savedAt', { path: result.filePath }) });
          onClose();
        } else {
          showToast({ type: 'error', message: t('voucherPrintModal.exportError', { error: result.error || t('voucherPrintModal.operationCancelled') }) });
        }
      } else {
        await exportPrintHtmlToPdf(buildHtml(), pdfFileStem(fileName));
        showToast({ type: 'success', message: t('voucherPrintModal.exportedPdfSuccess') });
        onClose();
      }
    } catch (error) {
      showToast({
        type: 'error',
        message: t('voucherPrintModal.exportError', { error: error instanceof Error ? error.message : t('voucherPrintModal.unknownError') }),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-5 text-right animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{t('voucherPrintModal.voucherHeader', { no: voucher.voucher_no })}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <p className="text-sm text-emerald-900 font-bold mb-2">{t('voucherPrintModal.statementPreviewLabel')}</p>
          <p className="text-sm text-slate-800 leading-relaxed">{narrativePreview}</p>
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
                {t('voucherPrintModal.printing')}
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                {t('voucherPrintModal.printA5')}
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
                {t('voucherPrintModal.exporting')}
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                {t('voucherPrintModal.exportPdf')}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={printing || exporting}
            className="w-full bg-slate-200 text-slate-900 py-2.5 rounded-lg hover:bg-slate-300 transition disabled:opacity-60 font-medium"
          >
            {t('voucherPrintModal.close')}
          </button>
        </div>

        <div className="text-xs text-slate-500 bg-slate-50 rounded p-3 text-right">
          {t('voucherPrintModal.typeField', { type: voucher.voucher_type === 'RECEIPT' ? t('voucher.typeReceipt') : t('voucher.typePayment') })}
          <br />
          {t('voucherPrintModal.dateField', { date: voucher.voucher_date })}
          <br />
          {t('voucherPrintModal.amountField', { amount: Number(voucher.amount).toLocaleString(i18n.language === 'ar' ? 'ar' : 'tr'), currency: voucher.currency_code })}
        </div>
      </div>
    </div>
  );
};
