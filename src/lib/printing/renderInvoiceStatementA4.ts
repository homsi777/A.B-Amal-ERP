import type { Invoice, InvoiceItem } from '../../types';
import { BRAND } from '../../branding';
import { AR_INVOICE_STATEMENT } from '../i18n/arTerminology';
import { resolveDisplayMaterialCode } from '../importDisplay';
import { displayStoredInvoiceNo } from '../invoiceDbMappers';
import { documentFooterStyles, renderDocumentFooterHtml } from './renderDocumentFooter';

const NAVY = '#2C405A';
const GOLD = '#C4A962';
const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";
/** رمادي فاتح للتسميات والمجاميع — قريب من النموذج الأساسي */
const LABEL_GRAY = '#f2f2f2';
const SUBTOTAL_GRAY = '#f6f6f6';
/** خط فصل خفيف بين الخانات */
const CELL_LINE = '#c8c8c8';

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

function formatInvoiceDate(dateIso: string): string {
  const raw = String(dateIso ?? '').trim();
  if (!raw) return '—';
  const datePart = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return raw;
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
    [item.materialName, item.fabricName, item.designCode, item.colorCode, item.colorName]
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
  return !s || s === '-' || s === '—';
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

function buildManagerNoteLines(): string[] {
  return [
    'يرجى التأكد من أرقام الأطوال وأرقام اللوطات قبل القص.',
    'يرجى مطابقة اللون ورقم اللون قبل تنفيذ القص.',
    'يفضل أن يتم القص من نفس اللوط لتجنب اختلافات اللون.',
    'الأقمشة المقصوصة أو المفتوحة لا تقبل الإرجاع.',
    'لا تقبل أي مطالبة بعد مرور 15 يوماً من تاريخ التسليم.',
  ];
}

export function renderInvoiceStatementA4Html(opts: {
  invoice: Invoice;
  partyName: string;
  hideFinancialColumns?: boolean;
  title?: string;
  subtitle?: string;
  /** عند true يُظهر شريط «مسودة غير مؤكدة» على المستند */
  isDraft?: boolean;
  draftLabel?: string;
}): string {
  const invoice = opts.invoice;
  const isDraft = opts.isDraft ?? invoice.documentStatus === 'DRAFT';
  const draftLabel = opts.draftLabel ?? AR_INVOICE_STATEMENT.draftBanner;
  const currency = (invoice.currency || 'USD').trim() || 'USD';
  const title = opts.title ?? 'إشعار تسليم تفصيلي';
  const subtitle = opts.subtitle ?? 'كشف الفاتورة';
  const invoiceNo = normalizeText(displayStoredInvoiceNo(invoice.invoiceNumber), '—');
  const invoiceDate = formatInvoiceDate(invoice.date);
  const partyName = normalizeText(opts.partyName, '—');
  const warehouse = normalizeText(invoice.warehouse, '—');
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
    designCode: normalizeText(
      resolveDisplayMaterialCode({
        internalCode: item.designCode,
        rawQrPayload: item.rawQrPayload,
      }),
      '—',
    ),
    barcode: normalizeBarcodeValue(item),
    lotNo: normalizeText(item.rollNo || item.rollNumber, ''),
    meters: Number(item.quantity || 0),
    kg: Number(item.weightKg ?? item.weight ?? 0),
    colorCode: normalizeText(item.colorCode, ''),
    colorName: normalizeText(item.colorName, ''),
    total: Number(item.total || 0),
  }));

  const lines: Line[] = rawLines.map((line) => {
    const parsed = splitCompositeMaterialName(
      line.materialName,
      isDashLike(line.designCode) ? '' : line.designCode,
      line.colorCode,
      line.colorName,
    );
    return {
      ...line,
      materialName: normalizeText(parsed.materialName, '—'),
      designCode: normalizeText(parsed.designCode, '—'),
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
    { materialName: string; designCode: string; meters: number; kg: number; totalAmount: number; colors: Set<string>; rolls: number }
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
        rolls: 0,
      };
    current.meters += group.totalMeters;
    current.kg += group.totalKg;
    current.totalAmount += group.totalAmount;
    current.rolls += group.rollCount;
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

  const shippingAddress = warehouse !== '—' ? `${partyName} - ${warehouse}` : partyName;

  const metaRowsHtml = `
    <div class="meta-row">
      <table class="meta-card">
        <tbody>
          <tr>
            <td class="meta-lbl">اسم العميل</td>
            <td class="meta-val">${escapeHtml(partyName)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">عنوان الشحن</td>
            <td class="meta-val">${escapeHtml(shippingAddress)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">رقم الفاتورة</td>
            <td class="meta-val mono">${escapeHtml(invoiceNo)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">البيان</td>
            <td class="meta-val">${escapeHtml(subtitle)}</td>
          </tr>
        </tbody>
      </table>
      <table class="meta-card">
        <tbody>
          <tr>
            <td class="meta-lbl">نوع الفاتورة</td>
            <td class="meta-val">${escapeHtml(invoice.type === 'purchase' ? 'شراء' : 'بيع')}</td>
          </tr>
          <tr>
            <td class="meta-lbl">التاريخ</td>
            <td class="meta-val mono">${escapeHtml(invoiceDate)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">رقم الفاتورة والتاريخ</td>
            <td class="meta-val mono">${escapeHtml(invoiceNo)} / ${escapeHtml(invoiceDate)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">طريقة النقل</td>
            <td class="meta-val">—</td>
          </tr>
        </tbody>
      </table>
    </div>`;

  const detailRows: Array<{ html: string; kind: 'line' | 'subtotal' | 'grand' }> = [];
  for (const group of groups) {
    for (const line of group.rows) {
      detailRows.push({
        kind: 'line',
        html: `
        <tr class="line-row">
          <td class="cell text">${escapeHtml(line.materialName)}</td>
          <td class="cell text center">${escapeHtml(line.designCode)}</td>
          <td class="cell text center">${escapeHtml(line.colorCode || '—')}</td>
          <td class="cell text center">${escapeHtml(line.colorName || '—')}</td>
          <td class="cell num">${formatAr(line.meters)}</td>
          <td class="cell num">${formatAr(line.kg)}</td>
          <td class="cell text center mono">${escapeHtml(line.barcode || '—')}</td>
          <td class="cell text center">${escapeHtml(line.lotNo || '—')}</td>
        </tr>`,
      });
    }

    const subtotalLabel =
      group.rollCount === 1 ? `${group.rollCount} نوب` : `إجمالي: ${group.rollCount} نوب`;

    detailRows.push({
      kind: 'subtotal',
      html: `
        <tr class="group-subtotal-row">
          <td class="subtotal-cell subtotal-label" colspan="4">${escapeHtml(subtotalLabel)}</td>
          <td class="subtotal-cell num">${formatAr(group.totalMeters)} mt</td>
          <td class="subtotal-cell num">${formatAr(group.totalKg)} kg</td>
          <td class="subtotal-cell" colspan="2"></td>
        </tr>`,
    });
  }

  const showGrandSubtotal = groups.length > 1;

  if (showGrandSubtotal) {
    detailRows.push({
      kind: 'grand',
      html: `
    <tr class="grand-subtotal-row">
      <td class="subtotal-cell subtotal-label strong" colspan="4">إجمالي: ${totalRollsAll} نوب</td>
      <td class="subtotal-cell num strong">${formatAr(totalMetersAll)} mt</td>
      <td class="subtotal-cell num strong">${formatAr(totalKgAll)} kg</td>
      <td class="subtotal-cell" colspan="2"></td>
    </tr>`,
    });
  }

  const summaryRows = summaryRowsData
    .map((row) => {
      const meterPrice = row.meters > 0 ? row.totalAmount / row.meters : 0;
      const colorLabel = row.colors.size === 1 ? '1 لون' : `${row.colors.size} لون`;
      const priceCell = hideFinancialColumns
        ? ''
        : `<td class="cell num">${formatAr(meterPrice)} ${escapeHtml(currency)}</td>`;
      const amountCell = hideFinancialColumns
        ? ''
        : `<td class="cell num">${formatAr(row.totalAmount)} ${escapeHtml(currency)}</td>`;
      return `
        <tr>
          <td class="cell text">${escapeHtml(row.materialName)}</td>
          <td class="cell text center">${escapeHtml(row.designCode)}</td>
          <td class="cell center">${colorLabel}</td>
          <td class="cell num">${formatAr(row.meters)}</td>
          <td class="cell num">${formatAr(row.kg)}</td>
          ${priceCell}
          ${amountCell}
        </tr>`;
    })
    .join('');

  const averageMeterPriceAll = totalMetersAll > 0 ? subtotalAmount / totalMetersAll : 0;
  const totalPriceCell = hideFinancialColumns
    ? ''
    : `<td class="cell num strong">${formatAr(averageMeterPriceAll)} ${escapeHtml(currency)}</td>`;
  const totalAmountCell = hideFinancialColumns
    ? ''
    : `<td class="cell num strong">${formatAr(subtotalAmount)} ${escapeHtml(currency)}</td>`;

  const financialHtml = hideFinancialColumns
    ? ''
    : `
      <table class="financial-table">
        <tbody>
          ${discountAmount > 0 ? `<tr>
            <td class="fin-label">(المجموع قبل الخصم)</td>
            <td class="fin-value num">${formatAr(subtotalAmount)} ${escapeHtml(currency)}</td>
          </tr>
          <tr>
            <td class="fin-label">(الخصم)</td>
            <td class="fin-value num">−${formatAr(discountAmount)} ${escapeHtml(currency)}</td>
          </tr>` : ''}
          ${taxAmount > 0 ? `<tr><td class="fin-label">(الضريبة)</td><td class="fin-value num">${formatAr(taxAmount)} ${escapeHtml(currency)}</td></tr>` : ''}
          <tr class="financial-final">
            <td class="fin-label">(الإجمالي النهائي)</td>
            <td class="fin-value num">${formatAr(invoiceFinalTotal)} ${escapeHtml(currency)}</td>
          </tr>
        </tbody>
      </table>`;

  const noteLines = buildManagerNoteLines();
  const invoiceNote = (invoice.notes || '').trim();

  const renderMainTable = (rowsHtml: string) => `
      <table class="data-table main-table">
        <colgroup>
          <col class="col-material" /><col class="col-design" /><col class="col-color-code" />
          <col class="col-color-name" /><col class="col-meter" /><col class="col-kg" />
          <col class="col-barcode" /><col class="col-lot" />
        </colgroup>
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
          ${rowsHtml || `<tr><td class="cell center" colspan="8">—</td></tr>`}
        </tbody>
      </table>`;

  const summaryAndTotalsHtml = `
      <div class="summary-section">
        <div class="section-title">ملخص الأشعار</div>
        <table class="data-table summary-table">
          <colgroup>
            <col class="sum-material" /><col class="sum-design" /><col class="sum-colors" />
            <col class="sum-meter" /><col class="sum-kg" />
            ${hideFinancialColumns ? '' : '<col class="sum-price" /><col class="sum-amount" />'}
          </colgroup>
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
            <tr class="summary-total-row">
              <td class="cell text strong" colspan="2">الإجمالي العام</td>
              <td class="cell center strong">${totalRollsAll} توب</td>
              <td class="cell num strong">${formatAr(totalMetersAll)}</td>
              <td class="cell num strong">${formatAr(totalKgAll)}</td>
              ${totalPriceCell}
              ${totalAmountCell}
            </tr>
          </tbody>
        </table>
      </div>

      <div class="bottom-row">
        <div class="notes-box">
          <div class="notes-title">ملاحظة:</div>
          ${invoiceNote ? `<div class="notes-line">• ${escapeHtml(invoiceNote)}</div>` : ''}
          ${noteLines.map((line) => `<div class="notes-line">• ${escapeHtml(line)}</div>`).join('')}
        </div>
        ${financialHtml}
      </div>

      <div class="signatures">
        <div class="signature-box">سلّمها (ختم/توقيع)</div>
        <div class="signature-box">استلمها (ختم/توقيع)</div>
      </div>`;

  // المسودة أطول قليلًا بسبب شريط التنبيه، لذلك لها سعة أقل بسطرين.
  const detailCapacity = isDraft ? 21 : 23;
  const singlePageBudget = isDraft ? 16 : 18;
  const summaryCost = summaryRowsData.length + 9;
  const fitsSinglePage = detailRows.length + summaryCost <= singlePageBudget;
  const detailChunks: typeof detailRows[] = [];

  if (fitsSinglePage) {
    detailChunks.push(detailRows);
  } else {
    for (let index = 0; index < detailRows.length;) {
      const chunk = detailRows.slice(index, index + detailCapacity);
      index += chunk.length;

      // إبقاء أسطر الإجماليات مع آخر سطر بيانات بدل ظهورها وحيدة في أول الصفحة التالية.
      while (chunk.length > 1 && index < detailRows.length && detailRows[index]?.kind !== 'line') {
        chunk.pop();
        index -= 1;
      }
      detailChunks.push(chunk);
    }
  }

  const pageContents = fitsSinglePage
    ? [`${renderMainTable(detailRows.map((row) => row.html).join(''))}${summaryAndTotalsHtml}`]
    : [
        ...detailChunks.map((chunk) => renderMainTable(chunk.map((row) => row.html).join(''))),
        summaryAndTotalsHtml,
      ];
  const totalPages = pageContents.length;
  const pagesHtml = pageContents
    .map(
      (content, pageIndex) => `
  <div class="page" data-clotex-doc="invoice-statement-a4">
    ${isDraft ? `<div class="draft-watermark">${escapeHtml(draftLabel)}</div>` : ''}
    <div class="page-no-box">${pageIndex + 1} / ${totalPages}</div>
    <div class="page-body">
      <div class="brand-wrap">
        <img src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" class="brand-logo" />
      </div>
      <div class="doc-title">${escapeHtml(title)}</div>
      ${isDraft ? `<div class="draft-banner">${escapeHtml(draftLabel)}</div>` : ''}
      ${metaRowsHtml}
      ${content}
    </div>
    ${renderDocumentFooterHtml('invoice')}
  </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="format-detection" content="telephone=no,email=no,address=no" />
  <title>${escapeHtml(title)}</title>
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
      height: 297mm;
      display: flex;
      flex-direction: column;
      padding: 7mm 10mm 5mm;
      position: relative;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .page:last-child { page-break-after: auto; break-after: auto; }
    .page-body { flex: 1 1 auto; min-height: 0; }
    .page-no-box {
      position: absolute;
      top: 7mm;
      left: 10mm;
      font-size: 9px;
      font-weight: 700;
      color: #111;
      direction: ltr;
      unicode-bidi: embed;
    }
    .brand-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 0 0 6px;
    }
    .brand-logo {
      height: 102px;
      width: auto;
      object-fit: contain;
    }
    .doc-title {
      text-align: center;
      font-size: 17px;
      font-weight: 900;
      color: ${NAVY};
      margin: 0 0 10px;
      line-height: 1.2;
    }
    .draft-banner {
      text-align: center;
      font-size: 14px;
      font-weight: 900;
      color: #92400e;
      background: #fef3c7;
      border: 2px solid #f59e0b;
      border-radius: 6px;
      padding: 7px 12px;
      margin: 0 0 10px;
      letter-spacing: 0.3px;
    }
    .draft-watermark {
      position: absolute;
      top: 42%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-28deg);
      font-size: 42px;
      font-weight: 900;
      color: #f59e0b;
      opacity: 0.1;
      white-space: nowrap;
      pointer-events: none;
      z-index: 0;
      user-select: none;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table th,
    table td {
      vertical-align: middle;
      box-sizing: border-box;
    }
    .meta-row {
      display: flex;
      gap: 12px;
      margin-bottom: 10px;
      direction: rtl;
    }
    .meta-card {
      flex: 1;
      border: 1px solid ${CELL_LINE};
    }
    .meta-card td {
      border-bottom: 1px solid ${CELL_LINE};
      padding: 7px 8px;
      font-size: 10px;
      line-height: 1.3;
      vertical-align: middle;
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
      padding-right: 10px;
    }
    .data-table {
      border: 1px solid #000;
      margin-bottom: 0;
    }
    .main-table {
      margin-bottom: 4px;
    }
    .summary-section {
      margin-top: 14px;
      margin-bottom: 12px;
    }
    .data-table thead th {
      background: ${NAVY};
      color: #fff;
      font-size: 9.5px;
      font-weight: 900;
      padding: 7px 4px;
      text-align: center;
      border: none;
      border-bottom: 1px solid ${NAVY};
      border-left: 1px solid rgba(255, 255, 255, 0.22);
      line-height: 1.3;
      vertical-align: middle;
    }
    .data-table thead th:last-child { border-left: none; }
    .data-table tbody .cell {
      padding: 7px 5px;
      font-size: 9.2px;
      font-weight: 700;
      color: #000;
      border-bottom: 1px solid ${CELL_LINE};
      border-left: 1px solid ${CELL_LINE};
      vertical-align: middle;
      line-height: 1.3;
      background: #fff;
    }
    .data-table tbody .cell:last-child { border-left: none; }
    .subtotal-cell {
      padding: 7px 5px;
      font-size: 9.5px;
      font-weight: 900;
      text-align: center;
      border-bottom: 1px solid ${CELL_LINE};
      border-left: 1px solid ${CELL_LINE};
      color: #000;
      background: ${SUBTOTAL_GRAY};
      vertical-align: middle;
      line-height: 1.3;
    }
    .subtotal-cell:first-child { border-left: none; }
    .subtotal-label { text-align: center; }
    .grand-subtotal-row .subtotal-cell {
      background: ${SUBTOTAL_GRAY};
      border-bottom: 1px solid ${CELL_LINE};
      font-weight: 900;
    }
    .summary-total-row .cell {
      background: ${SUBTOTAL_GRAY};
      border-bottom: 1px solid ${CELL_LINE};
      font-weight: 900;
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
    .section-title {
      text-align: center;
      font-size: 17px;
      font-weight: 900;
      color: ${NAVY};
      margin: 0 0 8px;
      line-height: 1.2;
    }
    .bottom-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-top: 12px;
    }
    .financial-table {
      flex: 0 0 36%;
      margin-top: 0;
      border: 1px solid ${CELL_LINE};
      font-size: 11px;
    }
    .financial-table td {
      border-bottom: 1px solid ${CELL_LINE};
      padding: 8px 10px;
      vertical-align: middle;
      line-height: 1.35;
    }
    .financial-table tr:last-child td { border-bottom: none; }
    .fin-label {
      background: ${LABEL_GRAY};
      text-align: right;
      font-weight: 700;
      width: 58%;
      border-left: 1px solid ${CELL_LINE};
      padding-right: 10px;
      padding-left: 8px;
    }
    .fin-value {
      background: #fff;
      text-align: right;
      font-weight: 900;
      white-space: nowrap;
      direction: ltr;
      unicode-bidi: embed;
      padding-right: 10px;
      padding-left: 8px;
    }
    .financial-final td {
      border-bottom: 3px solid ${NAVY};
      font-weight: 900;
    }
    .notes-box {
      flex: 0 0 48%;
      text-align: right;
      margin-top: 0;
    }
    .notes-title {
      font-size: 12px;
      font-weight: 900;
      color: #000;
      margin-bottom: 2px;
    }
    .notes-line {
      font-size: 8.8px;
      line-height: 1.35;
      font-weight: 700;
      margin-bottom: 2px;
      color: #000;
    }
    .signatures {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      margin: 20px 0 6px;
    }
    .signature-box {
      flex: 0 0 40%;
      min-height: 58px;
      border: 1px solid ${CELL_LINE};
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      text-align: center;
      font-size: 10px;
      font-weight: 900;
      color: #000;
      background: #fafafa;
    }
    ${documentFooterStyles(NAVY, GOLD)}
    .doc-footer-bar {
      flex-shrink: 0;
      margin: 4px -10mm 0;
      width: calc(100% + 20mm);
      padding: 9px 12px;
    }
    .col-material { width: 20%; }
    .col-design { width: 11%; }
    .col-color-code { width: 9%; }
    .col-color-name { width: 11%; }
    .col-meter { width: 10%; }
    .col-kg { width: 9%; }
    .col-barcode { width: 15%; }
    .col-lot { width: 15%; }
    .sum-material { width: 20%; }
    .sum-design { width: 12%; }
    .sum-colors { width: 12%; }
    .sum-meter { width: 12%; }
    .sum-kg { width: 10%; }
    .sum-price { width: 14%; }
    .sum-amount { width: 20%; }
    @media print {
      html, body, * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      html, body {
        width: 210mm;
        height: auto;
        overflow: visible;
      }
      .page {
        page-break-after: always;
        break-after: page;
        page-break-inside: avoid;
        overflow: hidden;
      }
      .page:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .doc-footer-bar {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;
}
