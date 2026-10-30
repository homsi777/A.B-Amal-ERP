import type { ApiIntakeDispatchSlip, ApiIntakeDispatchSlipLine } from '../api/intakeDispatchSlipsApi';
import { BRAND } from '../../branding';
import i18n from '../../i18n/config';

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNum(n: unknown, digits = 2): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : '0.00';
}

/**
 * كشف طباعة إرسالية مخزون/شراء — اتجاه الصفحة ولغتها من معامل `lang`
 * المُمرَّر صراحةً (بنفس نمط renderExternalJobDispatchA4Html)، لا i18n.language
 * الحالي ولا تثبيت ثابت.
 */
export function renderIntakeDispatchSlipA4Html(opts: {
  slip: ApiIntakeDispatchSlip;
  lines: ApiIntakeDispatchSlipLine[];
  lang: 'ar' | 'tr';
}): string {
  const { slip, lines, lang } = opts;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const t = (key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: 'intakeOperations', lng: lang, ...options });

  const totalRolls = lines.length;
  const totalM = lines.reduce((sum, l) => sum + (Number(l.length_m) || 0), 0);
  const totalValue = lines.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);
  const anyPriced = lines.some((l) => l.unit_price != null);

  const rowsHtml = lines
    .map(
      (line, index) => `
    <tr>
      <td class="cell center">${index + 1}</td>
      <td class="cell">${escapeHtml(line.item_name)}</td>
      <td class="cell center">${escapeHtml(line.color_name_ar || '—')}</td>
      <td class="cell center mono">${escapeHtml(line.barcode)}</td>
      <td class="cell center num">${formatNum(line.length_m)}</td>
      <td class="cell center num">${line.unit_price != null ? formatNum(line.unit_price, 4) : '—'}</td>
      <td class="cell center num">${line.line_total != null ? formatNum(line.line_total) : '—'}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(slip.slip_no)}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 210mm;
      font-family: Tahoma, Arial, 'Segoe UI', sans-serif;
      color: #111;
      background: #fff;
      direction: ${dir};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { width: 210mm; min-height: 297mm; padding: 10mm 10mm 8mm; }
    .brand { text-align: center; padding-bottom: 4mm; border-bottom: 0.4mm solid #333; margin-bottom: 4mm; }
    .brand img { height: 16mm; object-fit: contain; }
    .doc-title { text-align: center; font-size: 14pt; font-weight: 700; margin: 2mm 0 5mm; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 6mm; margin-bottom: 5mm; font-size: 10pt; }
    .meta .row { display: flex; gap: 2mm; }
    .meta .lbl { color: #555; font-weight: 700; }
    .meta .val { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    thead th { background: #2C405A; color: #fff; padding: 2.2mm; text-align: ${dir === 'rtl' ? 'right' : 'left'}; }
    .cell { border: 0.2mm solid #ccc; padding: 2mm; }
    .center { text-align: center; }
    .num { font-family: monospace; }
    .mono { font-family: monospace; }
    tfoot td { font-weight: 700; background: #f2f2f2; border: 0.2mm solid #ccc; padding: 2.2mm; }
    .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 10mm; font-size: 10pt; }
    .signature .lbl { font-weight: 700; color: #555; margin-bottom: 3mm; }
    .signature .line { border-bottom: 0.3mm solid #999; height: 9mm; }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand"><img src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" /></div>
    <div class="doc-title">
      ${slip.slip_type === 'PURCHASE' ? t('print.titlePurchase') : t('print.titleStock')}
    </div>

    <div class="meta">
      <div class="row"><span class="lbl">${t('print.slipNo')}:</span><span class="val mono">${escapeHtml(slip.slip_no)}</span></div>
      <div class="row"><span class="lbl">${t('print.orderNo')}:</span><span class="val mono">${escapeHtml(slip.order_no)}</span></div>
      <div class="row"><span class="lbl">${t('print.date')}:</span><span class="val">${escapeHtml(slip.created_at?.slice(0, 10))}</span></div>
      <div class="row"><span class="lbl">${t('print.supplier')}:</span><span class="val">${escapeHtml(slip.supplier_name)}</span></div>
      <div class="row"><span class="lbl">${t('print.warehouse')}:</span><span class="val">${escapeHtml(slip.warehouse_name)}</span></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>${t('colItem')}</th>
          <th>${t('colColor')}</th>
          <th>${t('colBarcode')}</th>
          <th>${t('print.colLength')}</th>
          <th>${t('colUnitPrice')}</th>
          <th>${t('print.colLineTotal')}</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="4">${t('print.totalsLabel', { count: totalRolls })}</td>
          <td class="num">${formatNum(totalM)}</td>
          <td colspan="2" class="num">${anyPriced ? formatNum(totalValue) : '—'}</td>
        </tr>
      </tfoot>
    </table>

    <div class="signature">
      <div class="signature-box">
        <div class="lbl">${t('print.deliveryNotes')}</div>
        <div class="line"></div>
        <div class="line"></div>
      </div>
      <div class="signature-box">
        <div class="lbl">${t('print.signature')}</div>
        <div class="line"></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
