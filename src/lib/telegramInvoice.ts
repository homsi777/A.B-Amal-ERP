import { Invoice } from '../types';
import { calculateFabricInvoiceSummary } from './fabricInvoiceSummary';
import { BRAND } from '../branding';
import { arInvoicePaymentStatusCode } from './i18n/arTerminology';
import { sendTelegramDocument } from './api/telegramApi';
import { buildInvoiceStatementFileName } from './printing/documentFileNames';
import {
  buildTelegramPurchaseInvoiceHtml,
  buildTelegramSaleInvoiceHtml,
} from './printing/telegramDocumentHtml';

interface TelegramInvoicePayload {
  invoice: Omit<Invoice, 'id' | 'type'> & { id?: string };
  invoiceType: 'sale' | 'purchase';
  partyName: string;
}

const formatNumber = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatMoney = (value: number, currency?: string) => `${formatNumber(value)} ${currency || 'USD'}`;

export function formatTelegramInvoiceMessage({ invoice, invoiceType, partyName }: TelegramInvoicePayload): string {
  const currency = invoice.currency || 'USD';
  const exchangeRateToUsd = currency === 'USD' ? 1 : Number(invoice.exchangeRateToUsd ?? 0);
  const totalUsd =
    currency === 'USD'
      ? invoice.totalAmount
      : invoice.totalAmountUsd ?? (exchangeRateToUsd > 0 ? invoice.totalAmount / exchangeRateToUsd : undefined);
  const paidUsd =
    currency === 'USD'
      ? invoice.paidAmount
      : invoice.paidAmountUsd ?? (exchangeRateToUsd > 0 ? invoice.paidAmount / exchangeRateToUsd : undefined);
  const remainingUsd =
    currency === 'USD'
      ? invoice.remainingAmount
      : invoice.remainingAmountUsd ?? (exchangeRateToUsd > 0 ? invoice.remainingAmount / exchangeRateToUsd : undefined);
  const summary = calculateFabricInvoiceSummary(
    invoice.items.map((item) => ({
      materialName: item.materialName || item.fabricName,
      designCode: item.designCode,
      colorCode: item.colorCode,
      colorName: item.colorName,
      rollNo: item.rollNo || item.rollNumber,
      lengthMeters: item.quantity,
      weightKg: item.weightKg ?? item.weight,
      pricePerMeter: item.unitPrice,
      lineTotal: item.total,
    })),
  );

  const headerIcon = invoiceType === 'sale' ? '🧾' : '📦';
  const title = invoiceType === 'sale' ? 'فاتورة بيع جديدة' : 'فاتورة شراء جديدة';
  const partyLabel = invoiceType === 'sale' ? 'العميل' : 'المورد';
  const invoiceNo = invoice.invoiceNumber || invoice.id || 'بدون رقم';

  const itemLines = invoice.items.slice(0, 20).map((item, index) => {
    const material = item.materialName || item.fabricName || 'غير محدد';
    const design = item.designCode || 'غير محدد';
    const color = item.colorName || item.colorCode || 'غير محدد';
    const roll = item.rollNo || item.rollNumber || '-';
    return `${index + 1}) ${material} / ${design} / ${color}\n   رول: ${roll} | متر: ${formatNumber(item.quantity)} | وزن: ${formatNumber(item.weightKg ?? item.weight ?? 0)} | سعر: ${formatMoney(item.unitPrice, currency)} | الإجمالي: ${formatMoney(item.total, currency)}`;
  });

  const groupLines = summary.groups.map((group) =>
    `- ${group.materialName} / ${group.designCode}: ألوان ${group.colorCount} | رولات ${group.rollCount} | أمتار ${formatNumber(group.totalMeters)} | وزن ${formatNumber(group.totalKg)} | ${formatMoney(group.totalAmount, currency)}`,
  );

  const moreItemsLine = invoice.items.length > 20 ? `\n\nتم اختصار الأصناف المعروضة في الرسالة: ${invoice.items.length} صنف.` : '';

  return `${headerIcon} ${title}

رقم الفاتورة: ${invoiceNo}
التاريخ: ${invoice.date}
${partyLabel}: ${partyName || 'نقدي'}
المستودع: ${invoice.warehouse || '-'}
العملة: ${currency}
${currency !== 'USD' && exchangeRateToUsd > 0 ? `سعر الصرف مقابل الدولار: ${exchangeRateToUsd}` : ''}
الحالة: ${arInvoicePaymentStatusCode(invoice.status)}

تفاصيل الأصناف:
${itemLines.join('\n') || 'لا يوجد أصناف'}
${moreItemsLine}

ملخص الخامات:
${groupLines.join('\n') || 'لا يوجد ملخص'}

الإجماليات:
عدد الرولات: ${summary.totals.rollCount}
إجمالي الأمتار: ${formatNumber(summary.totals.totalMeters)}
إجمالي الوزن: ${formatNumber(summary.totals.totalKg)}
إجمالي الفاتورة: ${formatMoney(invoice.totalAmount, currency)}
${currency !== 'USD' && totalUsd != null ? `إجمالي الفاتورة بالدولار: ${formatMoney(totalUsd, 'USD')}` : ''}
المدفوع: ${formatMoney(invoice.paidAmount, currency)}
${currency !== 'USD' && paidUsd != null ? `المدفوع بالدولار: ${formatMoney(paidUsd, 'USD')}` : ''}
المتبقي: ${formatMoney(invoice.remainingAmount, currency)}
${currency !== 'USD' && remainingUsd != null ? `المتبقي بالدولار: ${formatMoney(remainingUsd, 'USD')}` : ''}
عدد مجموعات الخامات: ${summary.totals.groupCount}

تم الإرسال من ${BRAND.name} — ${BRAND.tagline} (${BRAND.descriptionAr})`;
}

/** نفس قالب كشف الفاتورة A4 — للطباعة والتصدير وتيليغرام */
export function formatTelegramInvoicePdfHtml({ invoice, invoiceType, partyName }: TelegramInvoicePayload): string {
  const payload = { invoice: invoice as Invoice, partyName };
  return invoiceType === 'sale'
    ? buildTelegramSaleInvoiceHtml(payload)
    : buildTelegramPurchaseInvoiceHtml(payload);
}

export async function sendTelegramInvoiceNotification(payload: TelegramInvoicePayload): Promise<void> {
  const message = formatTelegramInvoiceMessage(payload);
  const pdfHtml = formatTelegramInvoicePdfHtml(payload);
  const invoiceNo = payload.invoice.invoiceNumber || payload.invoice.id || 'invoice';
  const partyName = payload.partyName || (payload.invoiceType === 'sale' ? 'عميل' : 'مورد');
  const fileName = `${buildInvoiceStatementFileName(partyName, invoiceNo)}.pdf`;
  await sendTelegramDocument({
    documentType: 'INVOICE',
    partyType: payload.invoiceType === 'sale' ? 'customer' : 'supplier',
    partyId: payload.invoice.partyId || null,
    targetType: payload.invoiceType === 'sale' ? 'CUSTOMER' : 'SUPPLIER',
    targetId: payload.invoice.partyId || null,
    message,
    pdfHtml,
    fileName,
    caption: payload.invoiceType === 'sale' ? 'فاتورة بيع PDF' : 'فاتورة شراء PDF',
    eventType: payload.invoiceType === 'sale' ? 'SALE_INVOICE' : 'PURCHASE_INVOICE',
  });
}
