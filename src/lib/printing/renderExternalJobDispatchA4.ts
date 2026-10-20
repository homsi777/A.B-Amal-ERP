import type { ExternalJobDetail } from '../api/externalJobsApi';
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
 * كشف طباعة مهمة خارجية (مصنعية/عامة) — اتجاه الصفحة ولغتها يُحدَّدان من معامل
 * `lang` المُمرَّر (مرتبط بلغة الشركة الافتراضية)، وليس i18n.language الحالي أو
 * أي تثبيت ثابت — خلافاً لقوالب أخرى بهذا المجلد تُثبِّت dir="rtl" دائماً.
 */
export function renderExternalJobDispatchA4Html(opts: {
  job: ExternalJobDetail;
  lang: 'ar' | 'tr';
}): string {
  const { job, lang } = opts;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const t = (key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: 'externalJobs', lng: lang, ...options });

  const lines = (job.lines ?? []).filter((l) => l.line_status !== 'CANCELLED');
  const totalRolls = lines.length;
  const totalM = lines.reduce((sum, l) => sum + (Number(l.sent_length_m) || 0), 0);
  const totalKg = lines.reduce((sum, l) => sum + (Number(l.roll_weight_kg) || 0), 0);

  const rowsHtml = lines
    .map(
      (line, index) => `
    <tr>
      <td class="cell center">${index + 1}</td>
      <td class="cell">${escapeHtml(line.item_name)}</td>
      <td class="cell center">${escapeHtml(line.sent_color_name_ar || '—')}</td>
      <td class="cell center mono">${escapeHtml(line.sent_color_code || '—')}</td>
      <td class="cell center num">${line.roll_width_cm != null ? formatNum(line.roll_width_cm) : '—'}</td>
      <td class="cell center num">${line.roll_gsm != null ? formatNum(line.roll_gsm) : '—'}</td>
      <td class="cell center mono">${escapeHtml(line.sent_barcode || line.current_barcode || '—')}</td>
      <td class="cell center num">${formatNum(line.sent_length_m)}</td>
      <td class="cell center num">${line.roll_weight_kg != null ? formatNum(line.roll_weight_kg) : '—'}</td>
    </tr>`,
    )
    .join('');

  const isProcessing = job.job_kind === 'PROCESSING';

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(job.job_no)}</title>
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
    .desc { margin-top: 4mm; font-size: 10pt; }
    .desc .lbl { font-weight: 700; color: #555; }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand"><img src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" /></div>
    <div class="doc-title">${t(isProcessing ? 'print.titleProcessing' : 'print.titleGeneral')}</div>

    <div class="meta">
      <div class="row"><span class="lbl">${t('print.dispatchNo')}:</span><span class="val mono">${escapeHtml(job.job_no)}</span></div>
      <div class="row"><span class="lbl">${t('print.date')}:</span><span class="val">${escapeHtml(job.sent_date)}</span></div>
      <div class="row"><span class="lbl">${t('print.party')}:</span><span class="val">${escapeHtml(job.supplier_name)}</span></div>
      <div class="row"><span class="lbl">${t('print.phone')}:</span><span class="val mono">${escapeHtml(job.supplier_phone || '—')}</span></div>
      ${isProcessing ? `
      <div class="row"><span class="lbl">${t('print.preparationType')}:</span><span class="val">${escapeHtml(job.preparation_type_name || '—')}</span></div>
      <div class="row"><span class="lbl">${t('processingNew.summaryOrderNo')}:</span><span class="val mono">#${escapeHtml(job.supplier_order_no ?? '—')}</span></div>
      ` : ''}
    </div>

    ${isProcessing && job.process_description ? `
    <div class="desc"><span class="lbl">${t('processingNew.processDescriptionLabel')}:</span> ${escapeHtml(job.process_description)}</div>
    ` : ''}

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>${t('processingNew.colItem')}</th>
          <th>${t('processingNew.colColor')}</th>
          <th>${t('print.colColorCode')}</th>
          <th>${t('print.colWidth')}</th>
          <th>${t('print.colGsm')}</th>
          <th>${t('processingNew.colBarcode')}</th>
          <th>${t('processingNew.colLength')}</th>
          <th>${t('processingNew.colWeight')}</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="7">${t('print.totalsLabel', { count: totalRolls })}</td>
          <td class="num">${formatNum(totalM)}</td>
          <td class="num">${formatNum(totalKg)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</body>
</html>`;
}
