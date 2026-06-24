import { BRAND } from '../branding';
import { sendTelegramDocument } from './api/telegramApi';
import { renderVoucherA5Html } from './printing/renderVoucherA5';

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

/** نفس قالب طباعة A5 — مصدر تصميم واحد للطباعة والتصدير وتيليغرام */
export function formatTelegramVoucherPdfHtml(payload: TelegramVoucherPayload): string {
  return renderVoucherA5Html({
    voucherNo: payload.voucherNo,
    voucherType: payload.voucherType,
    voucherDate: payload.voucherDate,
    partyName: payload.partyName,
    amount: String(payload.amount),
    currencyCode: payload.currency || 'USD',
    cashboxName: payload.cashboxName,
    description: payload.description,
  });
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
