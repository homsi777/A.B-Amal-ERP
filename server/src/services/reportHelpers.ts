import type { ReportColumn, SummaryCard, UnifiedReportPayload } from './reportTypes.js';
import { nowIso } from './reportTypes.js';

export const MAX_REPORT_PAGE = 200;

export function pageParams(q: Record<string, string | undefined>): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, parseInt(String(q.page || '1'), 10) || 1);
  const pageSize = Math.min(MAX_REPORT_PAGE, Math.max(1, parseInt(String(q.pageSize || '50'), 10) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function textCol(key: string, label: string): ReportColumn {
  return { key, label, type: 'text' };
}
export function numCol(key: string, label: string): ReportColumn {
  return { key, label, type: 'number' };
}
export function dateCol(key: string, label: string): ReportColumn {
  return { key, label, type: 'date' };
}
export function moneyCol(key: string, label: string): ReportColumn {
  return { key, label, type: 'currency' };
}

export function emptyReport(input: {
  key: string;
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  filtersApplied?: Record<string, unknown>;
  metaNote?: string;
  dataCompleteness?: 'FULL' | 'PARTIAL' | 'EMPTY_REASON';
}): UnifiedReportPayload {
  return {
    key: input.key,
    title: input.title,
    subtitle: input.subtitle,
    generatedAt: nowIso(),
    filtersApplied: input.filtersApplied ?? {},
    columns: input.columns,
    rows: [],
    meta: {
      note: input.metaNote,
      dataCompleteness: input.dataCompleteness ?? 'EMPTY_REASON',
      total: 0,
      page: 1,
      pageSize: 50,
    },
  };
}

export function buildReportPayload(base: Omit<UnifiedReportPayload, 'generatedAt'> & { generatedAt?: string }): UnifiedReportPayload {
  return {
    ...base,
    generatedAt: base.generatedAt ?? nowIso(),
  };
}
