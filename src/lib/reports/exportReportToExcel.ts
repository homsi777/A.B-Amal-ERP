import * as XLSX from 'xlsx';
import i18n from '../../i18n/config';
import type { UnifiedReportPayload } from './types';

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'reportsCenter', ...options });
}

function exportTotalLabel(label: string): string {
  const map: Record<string, string> = {
    total_materials: t('export.totals.totalMaterials'),
    total_rolls: t('export.totals.totalRolls'),
    total_length_m: t('export.totals.totalLengthM'),
    total_remaining_length_m: t('export.totals.totalRemainingLengthM'),
    total_sold_length_m: t('export.totals.totalSoldLengthM'),
    total_weight_kg: t('export.totals.totalWeightKg'),
    sold_meters: t('export.totals.soldMeters'),
    remaining_receivable_meters: t('export.totals.remainingReceivableMeters'),
  };
  return map[label] || label;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function safeReportFilename(reportKey: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const safe = reportKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  return `clotex-report-${safe}-${stamp}.xlsx`;
}

export function exportReportToExcel(report: UnifiedReportPayload, filename: string): void {
  const wsData: (string | number | boolean | null | undefined)[][] = [];

  wsData.push(['CLOTEX ERP']);
  wsData.push([report.title]);
  if (report.subtitle) wsData.push([t('export.descriptionLabel'), report.subtitle]);
  if (report.meta?.note) wsData.push([t('export.noteLabel'), report.meta.note]);
  wsData.push([t('export.generatedDateLabel'), new Date(report.generatedAt).toLocaleDateString(i18n.language === 'ar' ? 'ar-SY' : 'tr-TR')]);
  wsData.push([
    t('export.filtersLabel'),
    Object.entries(report.filtersApplied || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' | ') || '—',
  ]);
  wsData.push([]);

  const headers = report.columns.map((c) => c.label);
  wsData.push(headers);

  for (const row of report.rows) {
    wsData.push(
      report.columns.map((col) => {
        const v = row[col.key];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return v as string | number | boolean;
      }),
    );
  }

  if (report.totals && Object.keys(report.totals).length > 0) {
    wsData.push([]);
    wsData.push([t('export.totalsSectionLabel')]);
    for (const [k, v] of Object.entries(report.totals)) {
      wsData.push([exportTotalLabel(k), String(v)]);
    }
  }

  if (report.summaryCards?.length) {
    wsData.push([]);
    wsData.push([t('export.summarySectionLabel')]);
    for (const c of report.summaryCards) {
      wsData.push([c.label, String(c.value), c.hint ?? '']);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const colWidths = headers.map((h) => ({ wch: Math.min(40, Math.max(10, String(h).length + 2)) }));
  ws['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws, t('export.sheetName'));
  XLSX.writeFile(wb, filename);
}
