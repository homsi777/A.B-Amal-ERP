import { sendTelegramDocument } from './api/telegramApi';
import i18n from '../i18n/config';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'terminology', ...options });

export interface TelegramStatementPayload {
  partyType: 'customer' | 'supplier';
  partyId?: string | null;
  partyName: string;
  fromDate: string;
  toDate: string;
  itemCount: number;
  totalAmount: number;
  totalPayments: number;
  balanceLabel: string;
  balanceAmount: number;
  pdfHtml: string;
  fileName: string;
}

const formatMoney = (amount: number) =>
  amount.toLocaleString(i18n.language === 'ar' ? 'ar' : 'tr', { maximumFractionDigits: 2 });

export function formatTelegramStatementMessage(payload: Omit<TelegramStatementPayload, 'pdfHtml' | 'fileName'>): string {
  const title = payload.partyType === 'customer' ? t('telegramStatement.customerTitle') : t('telegramStatement.supplierTitle');
  return [
    t('telegramStatement.titleAndName', { title, name: payload.partyName }),
    t('telegramStatement.period', { from: payload.fromDate, to: payload.toDate }),
    t('telegramStatement.itemsLineCount', { count: payload.itemCount }),
    t('telegramStatement.total', { amount: formatMoney(payload.totalAmount) }),
    t('telegramStatement.paidSettled', { amount: formatMoney(payload.totalPayments) }),
    t('telegramStatement.balanceWithLabel', { label: payload.balanceLabel, amount: formatMoney(payload.balanceAmount) }),
    t('telegramStatement.pdfAttached'),
  ].join('\n');
}

export async function sendTelegramStatementPdf(payload: TelegramStatementPayload): Promise<void> {
  const { pdfHtml, fileName, ...messagePayload } = payload;
  await sendTelegramDocument({
    documentType: 'STATEMENT',
    partyType: messagePayload.partyType,
    partyId: messagePayload.partyId || null,
    targetType: messagePayload.partyType === 'customer' ? 'CUSTOMER' : 'SUPPLIER',
    targetId: messagePayload.partyId || null,
    message: formatTelegramStatementMessage(messagePayload),
    pdfHtml,
    fileName,
    caption: `PDF - ${messagePayload.partyName}`,
    eventType: messagePayload.partyType === 'customer' ? 'CUSTOMER_STATEMENT' : 'SUPPLIER_STATEMENT',
  });
}

export interface TelegramAccountStatementPayload {
  partyType: 'customer' | 'supplier';
  partyId?: string | null;
  partyName: string;
  fromDate: string;
  toDate: string;
  openingBalance: number;
  debitTotal: number;
  creditTotal: number;
  closingLabel: string;
  closingAmount: number;
  currency: string;
  rowsCount: number;
  pdfHtml: string;
  fileName: string;
}

export function formatTelegramAccountStatementMessage(
  payload: Omit<TelegramAccountStatementPayload, 'pdfHtml' | 'fileName'>,
): string {
  const title = payload.partyType === 'customer' ? t('telegramStatement.customerTitleWithMovements') : t('telegramStatement.supplierTitleWithMovements');
  return [
    t('telegramStatement.titleAndName', { title, name: payload.partyName }),
    t('telegramStatement.period', { from: payload.fromDate, to: payload.toDate }),
    t('telegramStatement.rowsCount', { count: payload.rowsCount }),
    t('telegramStatement.openingBalance', { amount: formatMoney(payload.openingBalance), currency: payload.currency }),
    t('telegramStatement.totalDebit', { amount: formatMoney(payload.debitTotal), currency: payload.currency }),
    t('telegramStatement.totalCredit', { amount: formatMoney(payload.creditTotal), currency: payload.currency }),
    t('telegramStatement.finalBalanceWithLabel', { label: payload.closingLabel, amount: formatMoney(payload.closingAmount), currency: payload.currency }),
    t('telegramStatement.pdfAttached'),
  ].join('\n');
}

export async function sendTelegramAccountStatementPdf(payload: TelegramAccountStatementPayload): Promise<void> {
  const { pdfHtml, fileName, ...messagePayload } = payload;
  await sendTelegramDocument({
    documentType: 'STATEMENT',
    partyType: messagePayload.partyType,
    partyId: messagePayload.partyId || null,
    targetType: messagePayload.partyType === 'customer' ? 'CUSTOMER' : 'SUPPLIER',
    targetId: messagePayload.partyId || null,
    message: formatTelegramAccountStatementMessage(messagePayload),
    pdfHtml,
    fileName,
    caption: `PDF - ${messagePayload.partyName}`,
    eventType: messagePayload.partyType === 'customer' ? 'CUSTOMER_STATEMENT' : 'SUPPLIER_STATEMENT',
  });
}
