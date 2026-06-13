import type { Invoice, InvoiceItem } from '../../types';
import { BRAND } from '../../branding';
import { displayStoredInvoiceNo } from '../invoiceDbMappers';

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
  return v.toLocaleString('ar', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function normalizeText(value: unknown, fallback: string): string {
  const s = String(value ?? '').trim();
  return s ? s : fallback;
}

function splitCompositeMaterialName(rawName: unknown, rawDesign: unknown, rawColorCode: unknown, rawColorName: unknown) {
  const materialName = String(rawName ?? '').trim();
  const designCode = String(rawDesign ?? '').trim();
  const colorCode = String(rawColorCode ?? '').trim();
  const colorName = String(rawColorName ?? '').trim();

  if (designCode || colorCode || colorName) return { materialName, designCode, colorCode, colorName };

  const parts = materialName
    .split(/\s*(?:[·|،,]| - )\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return { materialName, designCode, colorCode, colorName };

  return {
    materialName: parts[0] || materialName,
    designCode: parts[1] || '',
    colorCode: parts[2] || '',
    colorName: parts[2] || '',
  };
}

function normalizeBarcodeValue(item: InvoiceItem): string {
  const isUuidLike = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const isPrintableShortBarcode = (value: string) => /^\d{6,7}$/.test(value.trim());
  const invalidValues = new Set(
    [
      item.materialName,
      item.fabricName,
      item.designCode,
      item.colorCode,
      item.colorName,
    ]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  );
  const candidates = [item.printBarcode, item.supplierBarcode, item.barcode, item.rawBarcodePayload, item.rawQrPayload]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (invalidValues.has(candidate)) continue;
    if (isUuidLike(candidate)) continue;
    if (candidate.includes('|')) {
      const likelyBarcode = candidate
        .split('|')
        .map((part) => part.trim())
        .find((part) => part && !invalidValues.has(part) && !isUuidLike(part) && isPrintableShortBarcode(part));
      if (likelyBarcode) return likelyBarcode;
      continue;
    }
    if (isPrintableShortBarcode(candidate)) return candidate;
  }

  return '';
}

function isDashLike(value: string): boolean {
  const s = String(value || '').trim();
  return !s || s === '-' || s === '—' || s === 'â€”' || s === 'أ¢â‚¬â€Œ';
}

function splitPrintedCompositeLine(line: {
  materialName: string;
  designCode: string;
  colorCode: string;
  colorName: string;
}) {
  if (!isDashLike(line.designCode) || !isDashLike(line.colorCode) || !isDashLike(line.colorName)) {
    return line;
  }

  const normalized = String(line.materialName || '')
    .replace(/آ·|Â·|·|\|/g, '|')
    .replace(/ - /g, '|')
    .replace(/،|,/g, '|');
  const parts = normalized.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return line;

  return {
    ...line,
    materialName: parts[0] || line.materialName,
    designCode: parts[1] || line.designCode,
    colorCode: parts[2] || '',
    colorName: parts[2] || '',
  };
}

function buildNoteLines(invoiceNote: string): string[] {
  const notes = [
    invoiceNote,
    'يرجى التأكد من أرقام الأتواب وأرقام اللوطات قبل القص.',
    'يرجى مطابقة اللون ورقم اللون قبل تنفيذ القص.',
    'يفضل أن يتم القص من نفس اللوط لتجنب اختلافات اللون.',
    'الأقمشة المقصوصة أو المفتوحة لا تقبل الإرجاع.',
    'لا تقبل أي مطالبة بعد مرور 15 يوماً من تاريخ التسليم.',
  ]
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  return Array.from(new Set(notes));
}

export function renderInvoiceStatementA4Html(opts: {
  invoice: Invoice;
  partyName: string;
  hideFinancialColumns?: boolean;
  title?: string;
  subtitle?: string;
}): string {
  const invoice = opts.invoice;
  const currency = (invoice.currency || 'USD').trim() || 'USD';
  const title = opts.title ?? 'اشعار تسليم مفصل';
  const subtitle = opts.subtitle ?? 'كشف الفاتورة';
  const invoiceNo = normalizeText(displayStoredInvoiceNo(invoice.invoiceNumber), '—');
  const invoiceDate = normalizeText(invoice.date, '—');
  const partyName = normalizeText(opts.partyName, '—');
  const warehouse = normalizeText(invoice.warehouse, '—');
  const notes = (invoice.notes || '').trim();
  const hideFinancialColumns = Boolean(opts.hideFinancialColumns);

  type Line = {
    materialName: string;
    designCode: string;
    barcode: string;
    lotNo: string;
    meters: number;
    kg: number;
    colorCode: string;
    colorName: string;
    total: number;
  };

  const rawLines: Line[] = (invoice.items || []).map((item) => ({
    materialName: normalizeText(item.materialName || item.fabricName, '—'),
    designCode: normalizeText(item.designCode, '—'),
    barcode: normalizeBarcodeValue(item),
    lotNo: normalizeText(item.rollNo || item.rollNumber, ''),
    meters: Number(item.quantity || 0),
    kg: Number(item.weightKg ?? item.weight ?? 0),
    colorCode: normalizeText(item.colorCode, ''),
    colorName: normalizeText(item.colorName, ''),
    total: Number(item.total || 0),
  }));

  const lines: Line[] = rawLines.map((line) => {
    const parsed = splitCompositeMaterialName(line.materialName, line.designCode === 'â€”' ? '' : line.designCode, line.colorCode, line.colorName);
    return {
      ...line,
      materialName: normalizeText(parsed.materialName, 'â€”'),
      designCode: normalizeText(parsed.designCode, 'â€”'),
      colorCode: normalizeText(parsed.colorCode, ''),
      colorName: normalizeText(parsed.colorName, ''),
    };
  });

  for (const line of lines) {
    Object.assign(line, splitPrintedCompositeLine(line));
  }

  const groupMap = new Map<string, Line[]>();
  for (const line of lines) {
    const key = `${line.materialName}||${line.designCode}||${line.colorCode || line.colorName || '—'}`;
    const existing = groupMap.get(key);
    if (existing) existing.push(line);
    else groupMap.set(key, [line]);
  }

  const groups = Array.from(groupMap.values()).map((rows) => {
    const first = rows[0];
    const totalMeters = rows.reduce((sum, row) => sum + (Number.isFinite(row.meters) ? row.meters : 0), 0);
    const totalKg = rows.reduce((sum, row) => sum + (Number.isFinite(row.kg) ? row.kg : 0), 0);
    const totalAmount = rows.reduce((sum, row) => sum + (Number.isFinite(row.total) ? row.total : 0), 0);

    return {
      materialName: first.materialName,
      designCode: first.designCode,
      colorCode: first.colorCode,
      colorName: first.colorName,
      rows,
      totalMeters,
      totalKg,
      totalAmount,
      rollCount: rows.length,
    };
  });

  groups.sort((a, b) => {
    const materialSort = a.materialName.localeCompare(b.materialName);
    if (materialSort !== 0) return materialSort;
    const designSort = a.designCode.localeCompare(b.designCode);
    if (designSort !== 0) return designSort;
    return (a.colorCode || a.colorName).localeCompare(b.colorCode || b.colorName);
  });

  const summaryMap = new Map<
    string,
    { materialName: string; designCode: string; meters: number; kg: number; totalAmount: number; colors: Set<string> }
  >();

  for (const group of groups) {
    const key = `${group.materialName}||${group.designCode}`;
    const current =
      summaryMap.get(key) ?? {
        materialName: group.materialName,
        designCode: group.designCode,
        meters: 0,
        kg: 0,
        totalAmount: 0,
        colors: new Set<string>(),
      };
    current.meters += group.totalMeters;
    current.kg += group.totalKg;
    current.totalAmount += group.totalAmount;
    current.colors.add(group.colorCode || group.colorName || '—');
    summaryMap.set(key, current);
  }

  const summaryRowsData = Array.from(summaryMap.values()).sort((a, b) => {
    const materialSort = a.materialName.localeCompare(b.materialName);
    if (materialSort !== 0) return materialSort;
    return a.designCode.localeCompare(b.designCode);
  });

  const totalMetersAll = groups.reduce((sum, group) => sum + group.totalMeters, 0);
  const totalKgAll = groups.reduce((sum, group) => sum + group.totalKg, 0);
  const totalRollsAll = groups.reduce((sum, group) => sum + group.rollCount, 0);
  const totalAmountAll = groups.reduce((sum, group) => sum + group.totalAmount, 0);
  const subtotalAmount = invoice.subtotal != null && invoice.subtotal > 0 ? invoice.subtotal : totalAmountAll;
  const discountAmount = Math.max(0, invoice.discountTotal ?? 0);
  const taxAmount = Math.max(0, invoice.taxTotal ?? 0);
  const invoiceFinalTotal = invoice.totalAmount;

  const noteLines = buildNoteLines(notes);
  const mainColGroup = `
      <colgroup>
        <col class="col-material" />
        <col class="col-design" />
        <col class="col-color-code" />
        <col class="col-color-name" />
        <col class="col-meter" />
        <col class="col-kg" />
        <col class="col-barcode" />
        <col class="col-lot" />
      </colgroup>
    `;
  const summaryColGroup = hideFinancialColumns
    ? `
      <colgroup>
        <col class="sum-material" />
        <col class="sum-design" />
        <col class="sum-colors" />
        <col class="sum-meter" />
        <col class="sum-kg" />
      </colgroup>
    `
    : `
      <colgroup>
        <col class="sum-material" />
        <col class="sum-design" />
        <col class="sum-colors" />
        <col class="sum-meter" />
        <col class="sum-kg" />
        <col class="sum-price" />
        <col class="sum-amount" />
      </colgroup>
    `;
  const headerMainValue1 = `<td class="meta-value wide">${escapeHtml(partyName)}</td>`;
  const headerMainValue2 = `<td class="meta-value wide">${escapeHtml(partyName)}${warehouse !== '—' ? ` - ${escapeHtml(warehouse)}` : ''}</td>`;
  const headerMainValue3 = `<td class="meta-value wide mono">${escapeHtml(invoiceNo)}</td>`;
  const headerMainValue4 = `<td class="meta-value wide">${escapeHtml(notes || subtitle || '—')}</td>`;
  const headerSideValue1 = `<td class="meta-value">${escapeHtml(invoice.type === 'purchase' ? 'شراء' : 'بيع')}</td>`;
  const headerSideValue2 = `<td class="meta-value mono">${escapeHtml(invoiceDate)}</td>`;
  const headerSideValue3 = `<td class="meta-value mono">${escapeHtml(invoiceNo)} / ${escapeHtml(invoiceDate)}</td>`;
  const headerSideValue4 = `<td class="meta-value">—</td>`;
  const headerMainLabel1 = '<td class="meta-label">اسم العميل</td>';
  const headerMainLabel2 = '<td class="meta-label">عنوان الشحن</td>';
  const headerMainLabel3 = '<td class="meta-label">رقم الفاتورة</td>';
  const headerMainLabel4 = '<td class="meta-label">البيان</td>';
  const headerSideLabel1 = '<td class="meta-label">نوع الفاتورة</td>';
  const headerSideLabel2 = '<td class="meta-label">التاريخ</td>';
  const headerSideLabel3 = '<td class="meta-label">رقم الفاتورة والتاريخ</td>';
  const headerSideLabel4 = '<td class="meta-label">طريقة النقل</td>';

  const headerRows = `
    <table class="meta-table">
      <colgroup>
        <col class="meta-main-label-col" />
        <col class="meta-main-value-col" />
        <col class="meta-side-label-col" />
        <col class="meta-side-value-col" />
      </colgroup>
      <tbody>
        <tr>
          ${headerMainLabel1}
          ${headerMainValue1}
          ${headerSideLabel1}
          ${headerSideValue1}
        </tr>
        <tr>
          ${headerMainLabel2}
          ${headerMainValue2}
          ${headerSideLabel2}
          ${headerSideValue2}
        </tr>
        <tr>
          ${headerMainLabel3}
          ${headerMainValue3}
          ${headerSideLabel3}
          ${headerSideValue3}
        </tr>
        <tr>
          ${headerMainLabel4}
          ${headerMainValue4}
          ${headerSideLabel4}
          ${headerSideValue4}
        </tr>
      </tbody>
    </table>
  `;

  const bodyRows = groups
    .map((group, groupIndex) => {
      const rowsHtml = group.rows
        .map((line) => {
          return `
            <tr class="line-row">
              <td class="cell text col-material-cell">${escapeHtml(line.materialName)}</td>
              <td class="cell text col-design-cell">${escapeHtml(line.designCode)}</td>
              <td class="cell text">${escapeHtml(line.colorCode || '—')}</td>
              <td class="cell text">${escapeHtml(line.colorName || '—')}</td>
              <td class="cell num col-meter-cell">${formatAr(line.meters)}</td>
              <td class="cell num col-kg-cell">${formatAr(line.kg)}</td>
              <td class="cell text">${escapeHtml(line.barcode || '—')}</td>
              <td class="cell text">${escapeHtml(line.lotNo || '—')}</td>
            </tr>
          `;
        })
        .join('');

      const subtotalPrefix = groupIndex === 0 ? 'أ-ما,سبق ' : '';
      return `
        ${rowsHtml}
        <tr class="subtotal-row">
          <td class="subtotal-cell subtotal-label" colspan="4">${escapeHtml(`${subtotalPrefix}${group.rollCount} توب`)}</td>
          <td class="subtotal-cell num strong">${formatAr(group.totalMeters)}</td>
          <td class="subtotal-cell num strong">${formatAr(group.totalKg)}</td>
          <td class="subtotal-cell" colspan="2"></td>
        </tr>
      `;
    })
    .join('');

  const summaryRows = summaryRowsData
    .map((row) => {
      const meterPrice = row.meters > 0 ? row.totalAmount / row.meters : 0;
      const priceCell = hideFinancialColumns ? '' : `<td class="cell num">${formatAr(meterPrice)} ${escapeHtml(currency)}</td>`;
      const amountCell = hideFinancialColumns ? '' : `<td class="cell num">${formatAr(row.totalAmount)} ${escapeHtml(currency)}</td>`;
      return `
        <tr>
          <td class="cell text">${escapeHtml(row.materialName)}</td>
          <td class="cell text">${escapeHtml(row.designCode)}</td>
          <td class="cell center">${row.colors.size} لون</td>
          <td class="cell num">${formatAr(row.meters)}</td>
          <td class="cell num">${formatAr(row.kg)}</td>
          ${priceCell}
          ${amountCell}
        </tr>
      `;
    })
    .join('');

  const averageMeterPriceAll = totalMetersAll > 0 ? subtotalAmount / totalMetersAll : 0;
  const totalPriceCell = hideFinancialColumns ? '' : `<td class="cell num strong">${formatAr(averageMeterPriceAll)} ${escapeHtml(currency)}</td>`;
  const totalAmountCell = hideFinancialColumns ? '' : `<td class="cell num strong">${formatAr(subtotalAmount)} ${escapeHtml(currency)}</td>`;
  const financialBreakdownHtml = hideFinancialColumns
    ? ''
    : `
      <div class="financial-breakdown">
        <div class="financial-row"><span>المجموع (قبل الخصم)</span><span class="num">${formatAr(subtotalAmount)} ${escapeHtml(currency)}</span></div>
        ${discountAmount > 0 ? `<div class="financial-row"><span>الخصم</span><span class="num">−${formatAr(discountAmount)} ${escapeHtml(currency)}</span></div>` : ''}
        ${taxAmount > 0 ? `<div class="financial-row"><span>الضريبة</span><span class="num">${formatAr(taxAmount)} ${escapeHtml(currency)}</span></div>` : ''}
        <div class="financial-row strong"><span>الإجمالي النهائي</span><span class="num">${formatAr(invoiceFinalTotal)} ${escapeHtml(currency)}</span></div>
      </div>
    `;

  return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4; margin: 8mm 7mm 7mm; }
          * { box-sizing: border-box; }
          html, body { width: 100%; height: auto; }
          body {
            margin: 0;
            background: #ffffff;
            color: #000000;
            direction: rtl;
            font-family: Arial, Tahoma, "Segoe UI", sans-serif;
          }
          .page {
            width: 100%;
            min-height: 100%;
            padding: 0 1mm;
          }
          .brand-wrap {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 0 0 4px;
          }
          .brand-logo {
            height: 110px;
            width: auto;
            max-width: 220px;
            object-fit: contain;
          }
          .title {
            text-align: center;
            font-size: 18px;
            line-height: 1;
            font-weight: 900;
            margin: 0 0 6px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          .meta-table {
            border: 1px solid #000;
            margin-bottom: 18px;
            direction: rtl;
          }
          .meta-table td {
            border: 1px solid #000;
            padding: 6px 6px;
            font-size: 10.5px;
            line-height: 1.2;
            vertical-align: middle;
            font-weight: 700;
            direction: rtl;
          }
          .meta-label {
            text-align: center;
            font-weight: 900;
            white-space: nowrap;
          }
          .meta-value {
            text-align: right;
            padding-right: 8px;
          }
          .meta-value.wide {
            text-align: right;
          }
          .meta-main-value-col { width: 43%; }
          .meta-main-label-col { width: 14%; }
          .meta-side-value-col { width: 28%; }
          .meta-side-label-col { width: 15%; }
          .main-table,
          .summary-table { border-top: 1px solid #000; border-bottom: 1px solid #000; }
          .main-table .col-material { width: 22%; }
          .main-table .col-design { width: 12%; }
          .main-table .col-color-code { width: 10%; }
          .main-table .col-color-name { width: 12%; }
          .main-table .col-meter { width: 10%; }
          .main-table .col-kg { width: 10%; }
          .main-table .col-barcode { width: 13%; }
          .main-table .col-lot { width: 11%; }
          .summary-table .sum-material { width: ${hideFinancialColumns ? '26%' : '20%'}; }
          .summary-table .sum-design { width: ${hideFinancialColumns ? '20%' : '16%'}; }
          .summary-table .sum-colors { width: ${hideFinancialColumns ? '18%' : '13%'}; }
          .summary-table .sum-meter { width: ${hideFinancialColumns ? '18%' : '14%'}; }
          .summary-table .sum-kg { width: ${hideFinancialColumns ? '18%' : '12%'}; }
          .summary-table .sum-price { width: 11%; }
          .summary-table .sum-amount { width: 14%; }
          .main-table thead th,
          .summary-table thead th {
            font-size: 9px;
            padding: 2px 4px 4px;
            line-height: 1.1;
            text-align: center;
            font-weight: 900;
            border-bottom: 1px solid #000;
          }
          .main-table th,
          .main-table td,
          .summary-table th,
          .summary-table td {
            overflow: hidden;
          }
          .main-table th:nth-child(1), .main-table td:nth-child(1),
          .main-table th:nth-child(2), .main-table td:nth-child(2),
          .main-table th:nth-child(3), .main-table td:nth-child(3),
          .main-table th:nth-child(4), .main-table td:nth-child(4),
          .main-table th:nth-child(7), .main-table td:nth-child(7),
          .main-table th:nth-child(8), .main-table td:nth-child(8),
          .summary-table th:nth-child(1), .summary-table td:nth-child(1),
          .summary-table th:nth-child(2), .summary-table td:nth-child(2) {
            text-align: center;
          }
          .main-table th:nth-child(5), .main-table td:nth-child(5),
          .main-table th:nth-child(6), .main-table td:nth-child(6),
          .summary-table th:nth-child(3), .summary-table td:nth-child(3),
          .summary-table th:nth-child(4), .summary-table td:nth-child(4),
          .summary-table th:nth-child(5), .summary-table td:nth-child(5),
          .summary-table th:nth-child(6), .summary-table td:nth-child(6),
          .summary-table th:nth-child(7), .summary-table td:nth-child(7) {
            text-align: center;
          }
          .cell {
            padding: 2px 4px;
            font-size: 8.8px;
            line-height: 1.15;
            vertical-align: middle;
          }
          .line-row .cell { border-bottom: none; }
          .line-row .col-material-cell {
            white-space: nowrap;
            word-break: normal;
            overflow-wrap: normal;
            text-overflow: clip;
          }
          .text {
            text-align: right;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .num {
            text-align: right;
            font-family: Consolas, "Courier New", monospace;
            direction: ltr;
            unicode-bidi: embed;
          }
          .center {
            text-align: center;
          }
          .mono {
            font-family: Consolas, "Courier New", monospace;
            direction: ltr;
            unicode-bidi: embed;
          }
          .subtotal-cell {
            text-align: center;
            font-size: 9.2px;
            font-weight: 900;
            padding: 4px 4px;
            border-top: none;
            border-bottom: 1px solid #000;
          }
          .subtotal-label {
            text-align: center;
          }
          .section-title {
            margin: 12px 0 5px;
            text-align: center;
            font-size: 17px;
            line-height: 1;
            font-weight: 900;
          }
          .strong {
            font-weight: 900;
          }
          .notes {
            margin-top: 14px;
            width: 46%;
            margin-right: 0;
            margin-left: auto;
            text-align: right;
          }
          .notes-title {
            font-size: 12px;
            font-weight: 900;
            margin-bottom: 2px;
          }
          .notes-line {
            font-size: 8.2px;
            line-height: 1.2;
            font-weight: 700;
            margin-bottom: 1px;
          }
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 28px;
            align-items: stretch;
          }
          .signature-box {
            flex: 0 0 34%;
            min-height: 44px;
            border: 1px solid #000;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding-top: 4px;
            text-align: center;
            font-size: 10px;
            font-weight: 900;
          }
          .footer {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-top: 6px;
            font-size: 10px;
            font-weight: 900;
          }
          .footer .page-no {
            font-family: Consolas, "Courier New", monospace;
            direction: ltr;
            unicode-bidi: embed;
          }
          .summary-table .cell {
            border-bottom: none;
          }
          .summary-table tbody tr:not(:last-child) .cell {
            border-bottom: none;
          }
          .summary-table tbody tr:last-child .cell {
            border-top: none;
            padding-top: 4px;
          }
          .financial-breakdown {
            margin: 10px 0 14px;
            max-width: 320px;
            margin-right: auto;
            font-size: 11px;
            line-height: 1.5;
          }
          .financial-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding: 3px 0;
            border-bottom: 1px solid #ddd;
          }
          .financial-row.strong {
            font-weight: 900;
            border-bottom: 2px solid #000;
          }
          .financial-row .num {
            font-family: Consolas, monospace;
            direction: ltr;
            unicode-bidi: plaintext;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="brand-wrap">
            <img src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" class="brand-logo" />
          </div>
          <div class="title">${escapeHtml(title)}</div>
          ${headerRows}

          <table class="main-table">
            ${mainColGroup}
            <thead>
              <tr>
                <th>اسم الخامة</th>
                <th>كود الخامة</th>
                <th>كود اللون</th>
                <th>اللون</th>
                <th>متر</th>
                <th>كغ</th>
                <th>رقم الباركود</th>
                <th>رقم اللوط</th>
              </tr>
            </thead>
            <tbody>
              ${bodyRows || `<tr><td class="cell center" colspan="8">—</td></tr>`}
            </tbody>
          </table>

          <div class="section-title">ملخص الاشعار</div>
          <table class="summary-table">
            ${summaryColGroup}
            <thead>
              <tr>
                <th>اسم الخامة</th>
                <th>كود الخامة</th>
                <th>عدد الألوان</th>
                <th>متر</th>
                <th>كغ</th>
                ${hideFinancialColumns ? '' : '<th>السعر/م</th><th>الإجمالي</th>'}
              </tr>
            </thead>
            <tbody>
              ${summaryRows || `<tr><td class="cell center" colspan="${hideFinancialColumns ? 5 : 7}">—</td></tr>`}
              <tr>
                <td class="cell text strong" colspan="2">الإجمالي العام</td>
                <td class="cell center strong">${totalRollsAll} توب</td>
                <td class="cell num strong">${formatAr(totalMetersAll)}</td>
                <td class="cell num strong">${formatAr(totalKgAll)}</td>
                ${totalPriceCell}
                ${totalAmountCell}
              </tr>
            </tbody>
          </table>

          ${financialBreakdownHtml}

          <div class="notes">
            <div class="notes-title">ملاحظة:</div>
            ${noteLines.map((line) => `<div class="notes-line">${escapeHtml(line)}</div>`).join('')}
          </div>

          <div class="signatures">
            <div class="signature-box">سلّمها (ختم/توقيع)</div>
            <div class="signature-box">استلمها (ختم/توقيع)</div>
          </div>

          <div class="footer">
            <div class="page-no">1 / 1</div>
            <div></div>
          </div>
        </div>
      </body>
    </html>
  `;
}
