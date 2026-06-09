import { BRAND } from '../branding';
import { sendTelegramDocument } from './api/telegramApi';

export interface TelegramVoucherPayload {
  voucherType: 'RECEIPT' | 'PAYMENT';
  voucherNo: string;
  voucherDate: string;
  partyType: 'customer' | 'supplier' | 'other';
  partyId?: string | null;
  partyName: string;
  amount: number;
  currency?: string;
  cashboxName?: string;
  description?: string | null;
}

const money = (value: number, currency = 'USD') =>
  `${value.toLocaleString('ar', { maximumFractionDigits: 2 })} ${currency}`;

export function formatTelegramVoucherMessage(payload: TelegramVoucherPayload): string {
  const title = payload.voucherType === 'RECEIPT' ? 'سند قبض' : 'سند دفع';
  return [
    `${title}: ${payload.voucherNo}`,
    `التاريخ: ${payload.voucherDate}`,
    `الطرف: ${payload.partyName}`,
    `المبلغ: ${money(payload.amount, payload.currency)}`,
    `الصندوق: ${payload.cashboxName || '-'}`,
    `البيان: ${payload.description || '-'}`,
    `تم إرفاق ملف PDF من ${BRAND.name}.`,
  ].join('\n');
}

export function formatTelegramVoucherPdfHtml(payload: TelegramVoucherPayload): string {
  const title = payload.voucherType === 'RECEIPT' ? 'سند قبض' : 'سند دفع';
  const accent = payload.voucherType === 'RECEIPT' ? '#059669' : '#e11d48';
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 28px; font-family: Arial, Tahoma, sans-serif; color: #0f172a; direction: rtl; }
    .page { border: 1px solid #cbd5e1; padding: 28px; min-height: 760px; }
    .brand { border-bottom: 3px solid ${accent}; padding-bottom: 16px; margin-bottom: 26px; }
    .brand-name { color: ${BRAND.primaryColor}; font-size: 30px; font-weight: 900; letter-spacing: 3px; }
    h1 { margin: 12px 0 0; color: ${accent}; font-size: 30px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 20px; }
    .box { border: 1px solid #e2e8f0; background: #f8fafc; padding: 14px; border-radius: 8px; }
    .label { color: #64748b; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
    .value { font-size: 18px; font-weight: 900; }
    .amount { color: ${accent}; font-size: 28px; }
    .note { margin-top: 20px; border: 1px solid #e2e8f0; padding: 16px; min-height: 90px; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 90px; }
    .sig { border-top: 2px solid #0f172a; padding-top: 10px; font-weight: 800; text-align: center; }
  </style>
</head>
<body>
  <main class="page">
    <section class="brand">
      <div class="brand-name">${BRAND.name}</div>
      <div>${BRAND.tagline} - ${BRAND.descriptionAr}</div>
      <h1>${title}</h1>
    </section>
    <section class="grid">
      <div class="box"><div class="label">رقم السند</div><div class="value">${esc(payload.voucherNo)}</div></div>
      <div class="box"><div class="label">التاريخ</div><div class="value">${esc(payload.voucherDate)}</div></div>
      <div class="box"><div class="label">الطرف</div><div class="value">${esc(payload.partyName)}</div></div>
      <div class="box"><div class="label">الصندوق</div><div class="value">${esc(payload.cashboxName || '-')}</div></div>
      <div class="box"><div class="label">العملة</div><div class="value">${esc(payload.currency || 'USD')}</div></div>
      <div class="box"><div class="label">المبلغ</div><div class="value amount">${money(payload.amount, payload.currency)}</div></div>
    </section>
    <section class="note"><div class="label">البيان</div><div class="value">${esc(payload.description || '-')}</div></section>
    <section class="signatures"><div class="sig">المحاسب</div><div class="sig">الصندوق</div><div class="sig">المستلم</div></section>
  </main>
</body>
</html>`;
}

export async function sendTelegramVoucher(payload: TelegramVoucherPayload): Promise<void> {
  const message = formatTelegramVoucherMessage(payload);
  const pdfHtml = formatTelegramVoucherPdfHtml(payload);
  await sendTelegramDocument({
    documentType: 'VOUCHER',
    partyType: payload.partyType,
    partyId: payload.partyId || null,
    targetType: payload.partyType === 'customer' ? 'CUSTOMER' : payload.partyType === 'supplier' ? 'SUPPLIER' : 'OTHER',
    targetId: payload.partyId || null,
    message,
    pdfHtml,
    fileName: `${payload.voucherNo}.pdf`,
    caption: `${payload.voucherType === 'RECEIPT' ? 'سند قبض' : 'سند دفع'} PDF`,
    eventType: payload.voucherType,
  });
}
