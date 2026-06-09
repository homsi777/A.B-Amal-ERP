import React from 'react';
import { Download, FileText } from 'lucide-react';

interface Props {
  onExportExcel?: () => void | Promise<void>;
  onExportPdf?: () => void | Promise<void>;
  disabled?: boolean;
  disableReason?: string;
}

export const ReportToolbar = ({
  onExportExcel,
  onExportPdf,
  disabled,
  disableReason,
}: Props) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {onExportExcel ? (
      <button
        type="button"
        title={disableReason}
        disabled={disabled}
        onClick={onExportExcel}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-45"
      >
        <Download className="w-4 h-4" />
        Excel
      </button>
    ) : null}
    {onExportPdf ? (
      <button
        type="button"
        title={disableReason}
        disabled={disabled}
        onClick={onExportPdf}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-45"
      >
        <FileText className="w-4 h-4" />
        تصدير PDF
      </button>
    ) : null}
  </div>
);
