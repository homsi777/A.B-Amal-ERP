import React from 'react';
import { Download, FileText, Printer, X } from 'lucide-react';
import { A4PreviewModal } from '../printing/A4PreviewModal';

interface StatementPrintActionsModalProps {
  open: boolean;
  title: string;
  html: string;
  defaultFileName: string;
  onClose: () => void;
}

export const StatementPrintActionsModal: React.FC<StatementPrintActionsModalProps> = ({
  open,
  title,
  html,
  defaultFileName,
  onClose,
}) => {
  const [previewOpen, setPreviewOpen] = React.useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{title}</h3>
            <p className="mt-1 text-xs text-slate-500">اختر معاينة قبل الطباعة أو تصدير PDF.</p>
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
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white transition hover:bg-indigo-700"
          >
            <Printer className="h-4 w-4" />
            <span>معاينة وطباعة A4</span>
          </button>

          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700"
          >
            <Download className="h-4 w-4" />
            <span>تصدير PDF من المعاينة</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-3 font-bold text-slate-700 transition hover:bg-slate-200"
          >
            <FileText className="h-4 w-4" />
            <span>إغلاق</span>
          </button>
        </div>
      </div>

      <A4PreviewModal
        open={previewOpen}
        title={title}
        html={html}
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
