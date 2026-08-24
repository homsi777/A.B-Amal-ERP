import { BRAND } from '../../branding';
import { documentFooterStyles, renderDocumentFooterHtml } from './renderDocumentFooter';
import type { SoldMaterialReportRow } from '../api/soldMaterialsReportApi';

const NAVY = '#2C405A';
const FONT = "Tahoma, Arial, 'Segoe UI', sans-serif";

function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(value: string | number, digits = 2): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '0.00';
}

function formatDate(value: string): string {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : String(value || '—');
}

export function renderSoldMaterialsReportA4Html(opts: {
  rows: SoldMaterialReportRow[];
  searchQuery?: string;
  printedAt?: Date;
}): string {
  const rows = opts.rows ?? [];
  const printedAt = opts.printedAt ?? new Date();
  const totalMeters = rows.reduce((sum, row) => sum + (Number(row.meters) || 0), 0);
  const totalSales = rows.reduce((sum, row) => sum + (Number(row.line_total) || 0), 0);
  const subtitle = opts.searchQuery?.trim()
    ? `نتائج البحث: ${opts.searchQuery.trim()}`
    : 'جميع بنود الخامات المباعة من فواتير البيع المؤكدة فقط';
  const printedAtText = printedAt.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const body = rows.length
    ? rows.map((row, index) => `
        <tr>
          <td class="center mono">${index + 1}</td>
          <td>${escapeHtml(row.material_name || '—')}</td>
          <td class="center mono">${escapeHtml(row.material_code || '—')}</td>
          <td>${escapeHtml(row.customer_name || '—')}</td>
          <td class="center mono">${formatNumber(row.quantity, 3)} ${row.unit === 'yard' ? 'ياردة' : 'متر'}</td>
          <td class="center mono">${formatNumber(row.meters, 3)}</td>
          <td class="center mono">${formatNumber(row.unit_price, 2)} ${escapeHtml(row.currency_code || 'USD')}</td>
          <td class="center mono">${escapeHtml(row.invoice_no || '—')}</td>
          <td class="center mono">${escapeHtml(formatDate(row.invoice_date))}</td>
        </tr>`).join('')
    : '<tr><td class="empty" colspan="9">لا توجد خامات مباعة مطابقة للبحث.</td></tr>';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>تقرير خامات مباعة</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 297mm; margin: 0 auto; background: #fff; color: #111; direction: rtl; font-family: ${FONT}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 297mm; min-height: 210mm; padding: 7mm 8mm 5mm; display: flex; flex-direction: column; }
    .page-body { flex: 1; }
    .brand { text-align: center; margin-bottom: 4px; }
    .brand img { height: 56px; max-width: 180px; object-fit: contain; }
    h1 { margin: 0; text-align: center; color: ${NAVY}; font-size: 18px; line-height: 1.25; }
    .subtitle { margin: 4px 0 9px; text-align: center; color: #475569; font-size: 10px; font-weight: 700; }
    .meta { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 9px; font-size: 10px; font-weight: 700; }
    .meta div { border: 1px solid #cbd5e1; padding: 5px 8px; flex: 1; background: #f8fafc; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { background: ${NAVY}; color: #fff; padding: 6px 4px; border: 1px solid #46617d; font-size: 9.5px; text-align: center; }
    td { padding: 5px 4px; border: 1px solid #cbd5e1; font-size: 9px; vertical-align: middle; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    .center { text-align: center; }
    .mono { font-family: Consolas, 'Courier New', monospace; direction: ltr; unicode-bidi: embed; }
    .empty { padding: 22px; text-align: center; color: #64748b; font-weight: 700; }
    tfoot td { background: #eaf0f6; font-weight: 900; font-size: 9.5px; }
    ${documentFooterStyles(NAVY)}
    @media print { thead { display: table-header-group; } tfoot { display: table-footer-group; } tr { break-inside: avoid; page-break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="page" data-clotex-doc="sold-materials-report-a4">
    <div class="page-body">
      <div class="brand"><img src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" /></div>
      <h1>تقرير خامات مباعة</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
      <div class="meta">
        <div>تاريخ الطباعة: <span class="mono">${escapeHtml(printedAtText)}</span></div>
        <div>عدد البنود المباعة: <span class="mono">${rows.length.toLocaleString('en-US')}</span></div>
        <div>إجمالي الأمتار: <span class="mono">${formatNumber(totalMeters, 3)}</span></div>
      </div>
      <table>
        <thead><tr>
          <th style="width:4%">#</th><th style="width:18%">اسم الخامة</th><th style="width:11%">كود الخامة</th><th style="width:16%">اسم الزبون</th><th style="width:11%">الكمية</th><th style="width:9%">متر</th><th style="width:12%">سعر البيع</th><th style="width:10%">رقم الفاتورة</th><th style="width:9%">التاريخ</th>
        </tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="5">الإجمالي</td><td class="center mono">${formatNumber(totalMeters, 3)}</td><td colspan="3" class="center mono">إجمالي البيع: ${formatNumber(totalSales, 2)}</td></tr></tfoot>
      </table>
    </div>
    ${renderDocumentFooterHtml('invoice')}
  </div>
</body>
</html>`;
}
