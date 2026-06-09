import * as XLSX from 'xlsx';
import type { UnifiedReportPayload } from './types';

function arTotalLabel(label: string): string {
  const map: Record<string, string> = {
    total_materials: 'مجموع الخامات',
    total_rolls: 'مجموع الاتواب',
    total_length_m: 'مجموع اطوال',
    total_remaining_length_m: 'مجموع المتبقي',
    total_sold_length_m: 'مجموع المباع',
    total_weight_kg: 'مجموع اوزان',
    sold_meters: 'إجمالي الأمتار المباعة',
    remaining_receivable_meters: 'أمتار ضمن الذمم',
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
  if (report.subtitle) wsData.push(['وصف', report.subtitle]);
  if (report.meta?.note) wsData.push(['ملاحظة', report.meta.note]);
  wsData.push(['تاريخ التوليد', new Date(report.generatedAt).toLocaleDateString('ar-SY')]);
  wsData.push([
    'الفلاتر',
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
    wsData.push(['الإجماليات']);
    for (const [k, v] of Object.entries(report.totals)) {
      wsData.push([arTotalLabel(k), String(v)]);
    }
  }

  if (report.summaryCards?.length) {
    wsData.push([]);
    wsData.push(['ملخص']);
    for (const c of report.summaryCards) {
      wsData.push([c.label, String(c.value), c.hint ?? '']);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const colWidths = headers.map((h) => ({ wch: Math.min(40, Math.max(10, String(h).length + 2)) }));
  ws['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws, 'تقرير');
  XLSX.writeFile(wb, filename);
}
