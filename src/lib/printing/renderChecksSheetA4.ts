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

export type PrintableCheck = {
  id: string;
  check_no: string;
  bank_name: string;
  party_name: string | null;
  amount: string;
  currency_code: string;
  due_date: string;
  image_data: string | null;
};

/** صفحة A4 لطباعة دفعة شيكات مُحدَّدة — صور الشيكات جنباً إلى جنب ثم صفوفاً،
 * بترتيب المستخدم بالضبط (لا إعادة فرز)، مع بياناتها الأساسية تحت كل صورة. */
export function renderChecksSheetA4Html(opts: { checks: PrintableCheck[]; lang: 'ar' | 'tr' }): string {
  const { checks, lang } = opts;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const t = (key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: 'checksVault', lng: lang, ...options });

  const cardsHtml = checks
    .map(
      (c) => `
    <div class="card">
      ${c.image_data
        ? `<img class="check-image" src="${escapeHtml(c.image_data)}" alt="${escapeHtml(c.check_no)}" />`
        : `<div class="no-image">${escapeHtml(c.bank_name)}<br/><span class="mono">${escapeHtml(c.check_no)}</span></div>`}
      <div class="meta">
        <div><span class="lbl">${t('col.checkNo')}:</span> <span class="mono">${escapeHtml(c.check_no)}</span></div>
        <div><span class="lbl">${t('col.bank')}:</span> ${escapeHtml(c.bank_name)}</div>
        <div><span class="lbl">${t('col.party')}:</span> ${escapeHtml(c.party_name || '—')}</div>
        <div><span class="lbl">${t('col.amount')}:</span> <span class="mono">${Number(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${escapeHtml(c.currency_code)}</span></div>
        <div><span class="lbl">${t('col.dueDate')}:</span> ${escapeHtml(c.due_date)}</div>
      </div>
    </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t('print.title')}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: Tahoma, Arial, 'Segoe UI', sans-serif;
      color: #111;
      background: #fff;
      direction: ${dir};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .brand { text-align: center; padding-bottom: 3mm; border-bottom: 0.4mm solid #333; margin-bottom: 4mm; }
    .brand img { height: 14mm; object-fit: contain; }
    .doc-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 2mm 0 5mm; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5mm; }
    .card { border: 0.3mm solid #ccc; border-radius: 2mm; padding: 3mm; break-inside: avoid; page-break-inside: avoid; }
    .check-image { width: 100%; height: auto; max-height: 45mm; object-fit: contain; margin-bottom: 2mm; }
    .no-image {
      width: 100%; height: 30mm; display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #f3f4f6; color: #666; font-size: 11pt; font-weight: 700; margin-bottom: 2mm; border-radius: 1mm;
    }
    .meta { font-size: 9pt; display: grid; gap: 1mm; }
    .meta .lbl { font-weight: 700; color: #555; }
    .mono { font-family: monospace; }
  </style>
</head>
<body>
  <div class="brand"><img src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" /></div>
  <div class="doc-title">${t('print.title')} — ${t('totalCount', { count: checks.length })}</div>
  <div class="grid">${cardsHtml}</div>
</body>
</html>`;
}
