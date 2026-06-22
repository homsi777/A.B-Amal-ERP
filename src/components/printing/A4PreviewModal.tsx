import React from 'react';
import { Download, Loader2, Printer, X } from 'lucide-react';
import { exportHtmlDocumentToPdf, A4_FIXED_LAYOUT_PDF_OPTIONS, ELECTRON_A4_EMBEDDED_MARGINS } from '../../lib/pdfExport';
import { useToast } from '../NonBlockingToast';

type PageSize = 'A4' | 'A5';

interface A4PreviewModalProps {
  open: boolean;
  title: string;
  html: string;
  pageSize?: PageSize;
  defaultFileName?: string;
  /** مستند A4 بهيكل .page مدمج (كشف فاتورة) — يطابق التصدير مع الطباعة */
  fixedPageLayout?: boolean;
  onClose: () => void;
  onPrinted?: () => void;
  onExported?: () => void;
}

function openBrowserPrint(html: string, title: string) {
  const printWindow = window.open('', '_blank', 'width=980,height=900');
  if (!printWindow) return false;
  printWindow.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>${title}</title></head><body>${html}</body></html>`);
  printWindow.document.close();
  printWindow.onload = () => {
    window.setTimeout(() => {
      printWindow.print();
    }, 350);
  };
  return true;
}

export const A4PreviewModal: React.FC<A4PreviewModalProps> = ({
  open,
  title,
  html,
  pageSize = 'A4',
  defaultFileName,
  fixedPageLayout = false,
  onClose,
  onPrinted,
  onExported,
}) => {
  const { showToast } = useToast();
  const [printing, setPrinting] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  if (!open) return null;

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const useElectronPrint =
        window.fabricApp?.isElectron === true && typeof window.fabricApp.printHtml === 'function';

      if (useElectronPrint) {
        const settings = await window.fabricApp!.getSettings();
        const result = await window.fabricApp!.printHtml(html, {
          pageSize: pageSize as 'A4' | 'A5' | 'ROLL_LABEL',
          silent: Boolean(settings.silentA4PrintingEnabled),
          printerName: settings.defaultA4PrinterName ?? undefined,
          printBackground: true,
        });
        if (result.ok) {
          showToast({ type: 'success', message: 'تم إرسال المستند إلى الطابعة' });
          onPrinted?.();
        } else {
          showToast({ type: 'error', message: result.error || 'تعذرت الطباعة' });
        }
        return;
      }

      if (!openBrowserPrint(html, title)) {
        showToast({ type: 'error', message: 'اسمح بالنوافذ المنبثقة ثم أعد المحاولة' });
        return;
      }
      onPrinted?.();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذرت الطباعة' });
    } finally {
      setPrinting(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const filePrefix = String(defaultFileName || title || 'document')
        .trim()
        .replace(/\.pdf$/i, '')
        .replace(/[\\/:*?"<>|]+/g, '_');

      const useElectronPdf =
        window.fabricApp?.isElectron === true && typeof window.fabricApp.printToPdf === 'function';

      if (useElectronPdf) {
        const result = await window.fabricApp!.printToPdf(html, {
          pageSize: pageSize as 'A4' | 'A5' | 'ROLL_LABEL',
          defaultFileName: filePrefix,
          ...(fixedPageLayout && pageSize === 'A4'
            ? { margins: { ...ELECTRON_A4_EMBEDDED_MARGINS } }
            : {}),
        });
        if (result.ok) {
          showToast({ type: 'success', message: `تم حفظ PDF: ${result.filePath}` });
          onExported?.();
        } else {
          showToast({ type: 'error', message: result.error || 'تم إلغاء حفظ PDF' });
        }
        return;
      }

      await exportHtmlDocumentToPdf(
        html,
        filePrefix,
        fixedPageLayout && pageSize === 'A4'
          ? A4_FIXED_LAYOUT_PDF_OPTIONS
          : {
              orientation: 'portrait',
              pageFormat: pageSize === 'A5' ? 'a5' : 'a4',
              containerWidth: pageSize === 'A5' ? '148mm' : '210mm',
            },
      );
      showToast({ type: 'success', message: 'تم تصدير PDF بنجاح' });
      onExported?.();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر تصدير PDF' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/65 p-4">
      <div className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-lg font-black text-slate-900">{title}</h3>
            <p className="mt-0.5 text-xs text-slate-500">معاينة قبل الطباعة. راجع الصفحة ثم اختر طباعة أو PDF.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 bg-slate-200 p-4">
          <iframe
            title={title}
            srcDoc={html}
            className="h-full w-full rounded-lg border border-slate-300 bg-white shadow-inner"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <div className="text-xs font-bold text-slate-500">المقاس: {pageSize}</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={printing || exporting}
              className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-60"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={printing || exporting}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              PDF
            </button>
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={printing || exporting}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              طباعة
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
