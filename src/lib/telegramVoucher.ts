import { BRAND } from '../branding';
import type { VoucherRow } from './api/vouchersApi';
import { sendTelegramDocument } from './api/telegramApi';
import { buildVoucherFileName } from './printing/documentFileNames';
import { buildTelegramVoucherHtml } from './printing/telegramDocumentHtml';
import i18n from '../i18n/config';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'terminology', ...options });

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
  `${value.toLocaleString(i18n.language === 'ar' ? 'ar' : 'tr', { maximumFractionDigits: 2 })} ${currency}`;

export function formatTelegramVoucherMessage(payload: TelegramVoucherPayload): string {
  const title = payload.voucherType === 'RECEIPT' ? t('voucher.docTitleReceipt') : t('voucher.docTitlePayment');
  return [
    t('telegramVoucher.titleAndNo', { title, no: payload.voucherNo }),
    t('telegramVoucher.dateLine', { date: payload.voucherDate }),
    t('telegramVoucher.partyLine', { party: payload.partyName }),
    t('telegramVoucher.amountLine', { amount: money(payload.amount, payload.currency) }),
    t('telegramVoucher.cashboxLine', { cashbox: payload.cashboxName || '-' }),
    t('telegramVoucher.statementLine', { statement: payload.description || '-' }),
    t('telegramVoucher.pdfAttachedFromBrand', { brand: BRAND.name }),
  ].join('\n');
}

/** نفس قالب طباعة A5 — مصدر تصميم واحد للطباعة والتصدير وتيليغرام */
export function formatTelegramVoucherPdfHtml(voucher: VoucherRow): string {
  return buildTelegramVoucherHtml(voucher);
}

export async function sendTelegramVoucherFromRow(voucher: VoucherRow): Promise<void> {
  const partyType =
    voucher.party_type === 'CUSTOMER'
      ? 'customer'
      : voucher.party_type === 'SUPPLIER'
        ? 'supplier'
        : 'other';
  const payload: TelegramVoucherPayload = {
    voucherType: voucher.voucher_type,
    voucherNo: voucher.voucher_no,
    voucherDate: voucher.voucher_date,
    partyType,
    partyId: voucher.party_id,
    partyName: voucher.party_name,
    amount: Number(voucher.amount) || 0,
    currency: voucher.currency_code,
    cashboxName: voucher.cashbox_name ?? undefined,
    description: voucher.description,
  };
  const message = formatTelegramVoucherMessage(payload);
  const pdfHtml = formatTelegramVoucherPdfHtml(voucher);
  const fileName = `${buildVoucherFileName(voucher.voucher_type, voucher.party_name, voucher.voucher_no)}.pdf`;
  await sendTelegramDocument({
    documentType: 'VOUCHER',
    partyType: payload.partyType,
    partyId: payload.partyId || null,
    targetType: partyType === 'customer' ? 'CUSTOMER' : partyType === 'supplier' ? 'SUPPLIER' : 'OTHER',
    targetId: payload.partyId || null,
    message,
    pdfHtml,
    fileName,
    caption: t('telegramVoucher.captionPdf', { title: payload.voucherType === 'RECEIPT' ? t('voucher.docTitleReceipt') : t('voucher.docTitlePayment') }),
    eventType: payload.voucherType,
  });
}

/** @deprecated استخدم sendTelegramVoucherFromRow مع صف السند الكامل */
export async function sendTelegramVoucher(payload: TelegramVoucherPayload): Promise<void> {
  const voucher: VoucherRow = {
    id: '',
    voucher_no: payload.voucherNo,
    voucher_type: payload.voucherType,
    voucher_date: payload.voucherDate,
    cashbox_id: null,
    cashbox_name: payload.cashboxName ?? null,
    party_type: payload.partyType === 'customer' ? 'CUSTOMER' : payload.partyType === 'supplier' ? 'SUPPLIER' : 'OTHER',
    party_id: payload.partyId ?? null,
    party_name: payload.partyName,
    amount: String(payload.amount),
    currency_code: payload.currency || 'USD',
    payment_method: 'CASH',
    status: 'CONFIRMED',
    description: payload.description ?? null,
    confirmed_at: null,
    cancelled_at: null,
    created_at: payload.voucherDate,
  };
  await sendTelegramVoucherFromRow(voucher);
}
