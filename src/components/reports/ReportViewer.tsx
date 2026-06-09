import React, { useMemo, useState } from 'react';
import { Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import type { UnifiedReportPayload, ReportColumnDef } from '../../lib/reports/types';

interface Props {
  report: UnifiedReportPayload | null;
  loading: boolean;
  error: string | null;
  emptyMessage?: string;
  onPageChange?: (page: number) => void;
  enableSorting?: boolean;          // Enable column click sorting
  sortBy?: string;                  // Current sort column key
  sortDir?: 'asc' | 'desc';        // Current sort direction
  onSortChange?: (sortBy: string, sortDir: 'asc' | 'desc') => void; // Notify parent
}

function arTotalLabel(label: string): string {
  const map: Record<string, string> = {
    total_materials: 'مجموع الخامات',
    total_rolls: 'مجموع الاتواب',
    total_length_m: 'مجموع اطوال',
    total_remaining_length_m: 'مجموع المتبقي',
    total_sold_length_m: 'مجموع المباع',
    total_weight_kg: 'مجموع اوزان',
  };
  return map[label] || label;
}

function formatCell(col: ReportColumnDef, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (col.type === 'currency' && (typeof value === 'string' || typeof value === 'number')) {
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (col.type === 'number' && (typeof value === 'string' || typeof value === 'number')) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : String(value);
  }
  if (col.type === 'date' && value) {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('ar-SY');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface Props {
  report: UnifiedReportPayload | null;
  loading: boolean;
  error: string | null;
  emptyMessage?: string;
  onPageChange?: (page: number) => void;
  enableSorting?: boolean;          // Enable column click sorting
  sortBy?: string;                  // Current sort column key
  sortDir?: 'asc' | 'desc';        // Current sort direction
  onSortChange?: (sortBy: string, sortDir: 'asc' | 'desc') => void; // Notify parent
}

export const ReportViewer = ({
  report,
  loading,
  error,
  emptyMessage = 'لا توجد بيانات لهذا التقرير ضمن الفلاتر الحالية',
  onPageChange,
  enableSorting = false,
  sortBy: controlledSortBy,
  sortDir: controlledSortDir,
  onSortChange,
}: Props) => {
  // ── Sorting state ──────────────────────────────────────────────────────
  // Internal fallback when parent doesn't control sorting
  const [internalSortBy, setInternalSortBy] = useState<string>('');
  const [internalSortDir, setInternalSortDir] = useState<'asc' | 'desc'>('asc');
  const activeSortBy = controlledSortBy ?? internalSortBy;
  const activeSortDir = controlledSortDir ?? internalSortDir;

  const handleHeaderClick = (colKey: string) => {
    const newDir = activeSortBy === colKey && activeSortDir === 'asc' ? 'desc' : 'asc';
    if (onSortChange) {
      onSortChange(colKey, newDir);
    } else {
      setInternalSortBy(colKey);
      setInternalSortDir(newDir);
    }
  };

  // ── Derived data ───────────────────────────────────────────────────────
  const totalsCards = useMemo(
    () =>
      Object.entries(report?.totals || {}).map(([label, value]) => ({
        label: arTotalLabel(label),
        value: String(value),
      })),
    [report?.totals],
  );

  const pageInfo = useMemo(() => {
    if (!report?.meta?.total) return null;
    const p = report.meta.page ?? 1;
    const ps = report.meta.pageSize ?? 50;
    return { p, ps, total: report.meta.total, pages: Math.max(1, Math.ceil(report.meta.total / ps)) };
  }, [report]);

  // ── Early returns ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
        <Loader2 className="w-6 h-6 animate-spin" />
        جاري تحميل التقرير...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm" dir="rtl">
        {error}
      </div>
    );
  }

  if (!report) {
    return <p className="text-slate-500 text-sm text-center py-12">اختر تقريراً من القائمة</p>;
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const displayRows = report.rows ?? [];

  return (
    <div className="space-y-3" dir="rtl">
      {report.subtitle ? <p className="text-sm text-slate-600 font-medium border-r-4 border-indigo-200 pr-3">{report.subtitle}</p> : null}
      {report.meta?.note ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 text-amber-950 px-4 py-3 text-sm">
          {report.meta.note}
        </div>
      ) : null}
      {((report.summaryCards && report.summaryCards.length > 0) || totalsCards.length > 0) ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          {(report.summaryCards || []).map((c, i) => (
            <div
              key={`summary-${i}`}
              className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 flex flex-col gap-0.5 min-w-0"
            >
              <span className="text-[11px] font-bold text-slate-500 truncate">{c.label}</span>
              <span className="text-base font-black text-slate-900 font-mono truncate">{c.value}</span>
              {c.hint ? <span className="text-[10px] text-slate-400">{c.hint}</span> : null}
            </div>
          ))}
          {totalsCards.map((c, i) => (
            <div
              key={`total-${i}`}
              className="rounded-lg border border-indigo-200 bg-indigo-50/80 px-3 py-2 flex flex-col gap-0.5 min-w-0"
            >
              <span className="text-[11px] font-bold text-indigo-700 truncate">{c.label}</span>
              <span className="text-base font-black text-indigo-950 font-mono truncate">{c.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm min-w-[640px]">
          <thead>
            <tr className="bg-slate-800 text-slate-50">
              {report.columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 font-semibold whitespace-nowrap sticky top-0 ${
                    enableSorting ? 'cursor-pointer hover:bg-slate-700 transition-colors select-none' : ''
                  }`}
                  onClick={() => enableSorting && handleHeaderClick(col.key)}
                  title={enableSorting ? 'انقر للفرز' : undefined}
                >
                  {enableSorting ? (
                    <div className="flex items-center gap-1">
                      <span>{col.label}</span>
                      {activeSortBy === col.key && (
                        activeSortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
                      )}
                    </div>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={report.columns.length} className="px-4 py-12 text-center text-slate-600 font-medium">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              displayRows.map((row, ri) => (
                <tr
                  key={ri}
                  className={row.__is_group_summary ? 'bg-indigo-50/70 font-bold' : 'hover:bg-slate-50/80'}
                >
                  {report.columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-slate-800 whitespace-nowrap max-w-[280px] ${
                        row.__is_group_summary ? '' : 'truncate'
                      }`}
                    >
                      {formatCell(col, row[col.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageInfo && onPageChange && pageInfo.ps < 10000 ? (
        <div className="flex items-center justify-between text-xs text-slate-600 flex-wrap gap-2">
          <span>
            عرض {(pageInfo.p - 1) * pageInfo.ps + 1}–
            {Math.min(pageInfo.p * pageInfo.ps, pageInfo.total)} من {pageInfo.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pageInfo.p <= 1}
              onClick={() => onPageChange(pageInfo.p - 1)}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
            >
              السابق
            </button>
            <button
              type="button"
              disabled={pageInfo.p >= pageInfo.pages}
              onClick={() => onPageChange(pageInfo.p + 1)}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
            >
              التالي
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
