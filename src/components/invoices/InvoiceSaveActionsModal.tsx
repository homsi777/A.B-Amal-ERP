import React from 'react';
import { Download, FileText, Loader2, Printer, X } from 'lucide-react';
import type { Invoice } from '../../types';
import { renderInvoiceStatementA4Html } from '../../lib/printing/renderInvoiceStatementA4';
import { AR_INVOICE_STATEMENT } from '../../lib/i18n/arTerminology';
import { useToast } from '../NonBlockingToast';
import { A4PreviewModal } from '../printing/A4PreviewModal';

interface InvoiceSaveActionsModalProps {
  isOpen: boolean;
  invoice: Invoice | null;
  partyName: string;
  onClose: () => void;
}

function safeFilePart(value: unknown, fallback: string) {
  return String(value || fallback)
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim() || fallback;
}

export const InvoiceSaveActionsModal: React.FC<InvoiceSaveActionsModalProps> = ({
  isOpen,
  invoice,
  partyName,
  onClose,
}) => {
  const { showToast } = useToast();
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  if (!isOpen || !invoice) return null;

  const buildHtml = () =>
    renderInvoiceStatementA4Html({
      invoice,
      partyName,
      title: AR_INVOICE_STATEMENT.printTitle,
      subtitle: AR_INVOICE_STATEMENT.printSubtitle,
    });

  const safeInvoiceNo = safeFilePart(invoice.invoiceNumber || invoice.id, 'كشف');
  const defaultFileName = `كشف_فاتورة_${safeInvoiceNo}.pdf`;

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      if (window.fabricApp?.printToPdf) {
        const result = await window.fabricApp.printToPdf(buildHtml(), {
          pageSize: 'A4',
          defaultFileName,
        });
        if (result.ok) {
          showToast({ type: 'success', message: `تم حفظ PDF: ${result.filePath}` });
          onClose();
        } else {
          showToast({ type: 'error', message: result.error || 'تم إلغاء حفظ PDF' });
        }
        return;
      }

      showToast({ type: 'warning', message: 'تصدير PDF متاح عبر نسخة سطح المكتب' });
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر تصدير PDF' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] bg-slate-950/55 p-4 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">تم حفظ فاتورة البيع</h3>
            <p className="mt-1 text-xs text-slate-500">اختر الإجراء المطلوب الآن لهذه الفاتورة</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5 text-right">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="font-bold">الفاتورة: {invoice.invoiceNumber || invoice.id}</div>
            <div className="mt-1 text-xs">العميل: {partyName || '—'}</div>
          </div>

          <button
            type="button"
            disabled={exporting}
            onClick={() => setPreviewOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            <Printer className="h-4 w-4" />
            <span>معاينة وطباعة فاتورة A4</span>
          </button>

          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExportPdf()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span>{exporting ? 'جاري تجهيز PDF...' : 'تصدير PDF'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-3 font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-60"
          >
            <FileText className="h-4 w-4" />
            <span>إغلاق</span>
          </button>
        </div>
      </div>

      <A4PreviewModal
        open={previewOpen}
        title="معاينة فاتورة A4"
        html={buildHtml()}
        pageSize="A4"
        defaultFileName={defaultFileName}
        onClose={() => setPreviewOpen(false)}
        onPrinted={() => {
          setPreviewOpen(false);
          onClose();
        }}
        onExported={() => {
          setPreviewOpen(false);
          onClose();
        }}
      />
    </div>
  );
};
