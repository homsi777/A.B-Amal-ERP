import { sendTelegramDocument } from './api/telegramApi';

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
  amount.toLocaleString('ar', { maximumFractionDigits: 2 });

export function formatTelegramStatementMessage(payload: Omit<TelegramStatementPayload, 'pdfHtml' | 'fileName'>): string {
  const title = payload.partyType === 'customer' ? 'كشف حساب عميل' : 'كشف حساب مورد';
  return [
    `${title}: ${payload.partyName}`,
    `الفترة: من ${payload.fromDate} إلى ${payload.toDate}`,
    `عدد أسطر الكشف: ${payload.itemCount}`,
    `الإجمالي: ${formatMoney(payload.totalAmount)}`,
    `المدفوع/المسدد: ${formatMoney(payload.totalPayments)}`,
    `الرصيد ${payload.balanceLabel}: ${formatMoney(payload.balanceAmount)}`,
    'تم إرفاق ملف PDF الخاص بالكشف.'
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
  const title = payload.partyType === 'customer' ? 'كشف حساب عميل (حركات مالية)' : 'كشف حساب مورد (حركات مالية)';
  return [
    `${title}: ${payload.partyName}`,
    `الفترة: من ${payload.fromDate} إلى ${payload.toDate}`,
    `عدد الحركات: ${payload.rowsCount}`,
    `الرصيد الافتتاحي: ${formatMoney(payload.openingBalance)} ${payload.currency}`,
    `إجمالي المدين: ${formatMoney(payload.debitTotal)} ${payload.currency}`,
    `إجمالي الدائن: ${formatMoney(payload.creditTotal)} ${payload.currency}`,
    `الرصيد النهائي (${payload.closingLabel}): ${formatMoney(payload.closingAmount)} ${payload.currency}`,
    'تم إرفاق ملف PDF الخاص بالكشف.',
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
