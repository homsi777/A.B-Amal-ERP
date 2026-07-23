import type { FabricRollDto } from '../api/fabricRollsApi';
import { BRAND } from '../../branding';
import {
  displayImportedColorCode,
  displayImportedColorName,
  displayInventoryMaterialCode,
} from '../importDisplay';
import { getRollLengthMeters } from '../inventory/rollAvailability';
import { documentFooterStyles, renderDocumentFooterHtml } from './renderDocumentFooter';

const NAVY = '#2C405A';
const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";
const LABEL_GRAY = '#f2f2f2';
const SUBTOTAL_GRAY = '#f6f6f6';
const CELL_LINE = '#c8c8c8';

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'متاح',
  RESERVED: 'محجوز',
  SOLD: 'مباع',
  DAMAGED: 'تالف',
  TRANSFERRED: 'منقول',
  INACTIVE: 'غير نشط',
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAr(n: number, digits = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPrintDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatPrintTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function rollWeightKg(roll: FabricRollDto): number {
  const raw = roll.actual_weight_kg ?? roll.calculated_weight_kg ?? '0';
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : 0;
}

function rollStatusLabel(roll: FabricRollDto): string {
  return STATUS_LABELS[roll.status] ?? roll.status ?? '—';
}

export function renderInventoryRollsAuditA4Html(opts: {
  rolls: FabricRollDto[];
  searchQuery?: string;
  scopeLabel: string;
  warehouseLabel: string;
  printedAt?: Date;
}): string {
  const rolls = opts.rolls ?? [];
  const printedAt = opts.printedAt ?? new Date();
  const searchQuery = String(opts.searchQuery ?? '').trim();
  const scopeLabel = String(opts.scopeLabel ?? '').trim() || '—';
  const warehouseLabel = String(opts.warehouseLabel ?? '').trim() || 'كل المستودعات';

  const totalMeters = rolls.reduce((sum, roll) => sum + getRollLengthMeters(roll), 0);
  const totalKg = rolls.reduce((sum, roll) => sum + rollWeightKg(roll), 0);

  const subtitle = searchQuery
    ? `نتائج البحث: ${searchQuery}`
    : 'جميع الأتواب الظاهرة حسب الفلتر الحالي';

  const bodyRows = rolls
    .map((roll, index) => {
      const materialCode = displayInventoryMaterialCode({
        internal_code: roll.internal_code,
        supplier_code_item: roll.supplier_code_item,
      });
      const colorName = displayImportedColorName(roll.color_name_ar || roll.color_name_tr);
      const colorCode = displayImportedColorCode(roll.color_code);
      const lengthM = getRollLengthMeters(roll);
      const weight = rollWeightKg(roll);

      return `
        <tr class="line-row">
          <td class="cell num center">${index + 1}</td>
          <td class="cell mono center">${escapeHtml(roll.barcode || '—')}</td>
          <td class="cell text">${escapeHtml(roll.item_name || '—')}</td>
          <td class="cell mono center">${escapeHtml(materialCode || '—')}</td>
          <td class="cell text center">${escapeHtml(colorName)}</td>
          <td class="cell mono center">${escapeHtml(colorCode)}</td>
          <td class="cell num">${formatAr(lengthM)}</td>
          <td class="cell num">${formatAr(weight)}</td>
          <td class="cell text center">${escapeHtml(roll.warehouse_name || '—')}</td>
          <td class="cell center">${escapeHtml(rollStatusLabel(roll))}</td>
        </tr>`;
    })
    .join('');

  const metaRowsHtml = `
    <div class="meta-row">
      <table class="meta-card">
        <tbody>
          <tr>
            <td class="meta-lbl">تاريخ الطباعة</td>
            <td class="meta-val mono">${escapeHtml(formatPrintDate(printedAt))} ${escapeHtml(formatPrintTime(printedAt))}</td>
          </tr>
          <tr>
            <td class="meta-lbl">نطاق العرض</td>
            <td class="meta-val">${escapeHtml(scopeLabel)}</td>
          </tr>
        </tbody>
      </table>
      <table class="meta-card">
        <tbody>
          <tr>
            <td class="meta-lbl">المستودع</td>
            <td class="meta-val">${escapeHtml(warehouseLabel)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">عدد الأتواب</td>
            <td class="meta-val mono">${rolls.length.toLocaleString('en-US')}</td>
          </tr>
        </tbody>
      </table>
    </div>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="format-detection" content="telephone=no,email=no,address=no" />
  <title>كشف جرد أتواب الأقمشة</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 210mm;
      max-width: 210mm;
      margin: 0 auto;
      font-family: ${FONT};
      color: #111;
      background: #fff;
      direction: rtl;
      overflow-x: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      display: flex;
      flex-direction: column;
      padding: 7mm 8mm 5mm;
    }
    .page-body { flex: 1 1 auto; min-height: 0; }
    .brand-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 0 0 6px;
    }
    .brand-logo {
      height: 88px;
      width: auto;
      object-fit: contain;
    }
    .doc-title {
      text-align: center;
      font-size: 16px;
      font-weight: 900;
      color: ${NAVY};
      margin: 0 0 4px;
      line-height: 1.2;
    }
    .doc-subtitle {
      text-align: center;
      font-size: 10px;
      font-weight: 700;
      color: #333;
      margin: 0 0 10px;
      line-height: 1.35;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table th, table td { vertical-align: middle; box-sizing: border-box; }
    .meta-row {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
      direction: rtl;
    }
    .meta-card {
      flex: 1;
      border: 1px solid ${CELL_LINE};
    }
    .meta-card td {
      border-bottom: 1px solid ${CELL_LINE};
      padding: 6px 8px;
      font-size: 9.5px;
      line-height: 1.3;
      font-weight: 700;
      color: #000;
    }
    .meta-card tr:last-child td { border-bottom: none; }
    .meta-lbl {
      width: 42%;
      text-align: center;
      background: ${LABEL_GRAY};
      white-space: nowrap;
      border-left: 1px solid ${CELL_LINE};
    }
    .meta-val {
      text-align: right;
      background: #fff;
      padding-right: 8px;
    }
    .data-table {
      border: 1px solid #000;
      margin-bottom: 0;
    }
    .data-table thead th {
      background: ${NAVY};
      color: #fff;
      font-size: 9.5px;
      font-weight: 900;
      padding: 6px 3px;
      text-align: center;
      border: none;
      border-bottom: 1px solid ${NAVY};
      border-left: 1px solid rgba(255, 255, 255, 0.22);
      line-height: 1.25;
      vertical-align: middle;
    }
    .data-table thead th:last-child { border-left: none; }
    .data-table tbody .cell {
      padding: 5px 3px;
      font-size: 9.2px;
      font-weight: 700;
      color: #000;
      border-bottom: 1px solid ${CELL_LINE};
      border-left: 1px solid ${CELL_LINE};
      vertical-align: middle;
      line-height: 1.25;
      background: #fff;
    }
    .data-table tbody .cell:last-child { border-left: none; }
    .data-table tbody tr:last-child .cell { border-bottom: none; }
    .summary-row .cell {
      background: ${SUBTOTAL_GRAY};
      font-weight: 900;
      font-size: 9.5px;
      border-top: 1px solid #000;
    }
    .text { text-align: right; word-break: break-word; }
    .center { text-align: center; }
    .num {
      text-align: center;
      font-family: Consolas, "Courier New", monospace;
      direction: ltr;
      unicode-bidi: embed;
    }
    .mono {
      font-family: Consolas, "Courier New", monospace;
      direction: ltr;
      unicode-bidi: embed;
    }
    .print-note {
      margin-top: 8px;
      font-size: 8.5px;
      font-weight: 700;
      color: #444;
      text-align: center;
      line-height: 1.4;
    }
    ${documentFooterStyles(NAVY)}
    @media print {
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tr { page-break-inside: avoid; }
      .page { min-height: auto; }
    }
  </style>
</head>
<body>
  <div class="page" data-clotex-doc="inventory-rolls-audit-a4">
    <div class="page-body">
      <div class="brand-wrap">
        <img class="brand-logo" src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" />
      </div>
      <h1 class="doc-title">كشف جرد أتواب الأقمشة</h1>
      <p class="doc-subtitle">${escapeHtml(subtitle)}</p>
      ${metaRowsHtml}
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:4%">#</th>
            <th style="width:10%">الباركود</th>
            <th style="width:16%">اسم الخامة</th>
            <th style="width:11%">كود الخامة</th>
            <th style="width:11%">اللون</th>
            <th style="width:8%">كود اللون</th>
            <th style="width:8%">متر</th>
            <th style="width:8%">كغ</th>
            <th style="width:12%">المستودع</th>
            <th style="width:12%">الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="summary-row">
            <td class="cell center" colspan="6">الإجمالي (${rolls.length.toLocaleString('en-US')} ثوب)</td>
            <td class="cell num">${formatAr(totalMeters)}</td>
            <td class="cell num">${formatAr(totalKg)}</td>
            <td class="cell" colspan="2"></td>
          </tr>
        </tbody>
      </table>
      <p class="print-note">يُطبع هذا الكشف حسب نتائج البحث والفلاتر الظاهرة على الشاشة — وليس كامل المخزون.</p>
    </div>
    ${renderDocumentFooterHtml('invoice')}
  </div>
</body>
</html>`;
}

export function buildInventoryRollsAuditFileName(searchQuery: string): string {
  const base = searchQuery.trim()
    ? `جرد_أتواب_${searchQuery.trim().replace(/[<>:"/\\|?*]/g, '_').slice(0, 40)}`
    : 'جرد_أتواب_حسب_الفلتر';
  return base;
}
