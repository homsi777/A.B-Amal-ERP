import { Invoice } from '../types';
import { calculateFabricInvoiceSummary } from './fabricInvoiceSummary';
import { BRAND } from '../branding';
import { arInvoicePaymentStatusCode } from './i18n/arTerminology';
import { sendTelegramDocument } from './api/telegramApi';
import { buildInvoiceStatementFileName } from './printing/documentFileNames';
import { buildTelegramInvoiceHtml } from './printing/telegramDocumentHtml';
import i18n from '../i18n/config';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'terminology', ...options });

interface TelegramInvoicePayload {
  invoice: Omit<Invoice, 'id' | 'type'> & { id?: string };
  invoiceType: 'sale' | 'purchase';
  partyName: string;
}

const formatNumber = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatMoney = (value: number, currency?: string) => `${formatNumber(value)} ${currency || 'USD'}`;

export function formatTelegramInvoiceMessage({ invoice, invoiceType, partyName }: TelegramInvoicePayload): string {
  const isDraft = invoice.documentStatus === 'DRAFT';
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
  const title = isDraft
    ? invoiceType === 'sale'
      ? t('telegramInvoice.titleSaleDraft')
      : t('telegramInvoice.titlePurchaseDraft')
    : invoiceType === 'sale'
      ? t('telegramInvoice.titleSaleNew')
      : t('telegramInvoice.titlePurchaseNew');
  const partyLabel = invoiceType === 'sale' ? t('telegramInvoice.partyLabelCustomer') : t('telegramInvoice.partyLabelSupplier');
  const invoiceNo = invoice.invoiceNumber || invoice.id || t('telegramInvoice.noNumberFallback');

  const itemLines = invoice.items.slice(0, 20).map((item, index) => {
    const material = item.materialName || item.fabricName || t('telegramInvoice.notSpecified');
    const design = item.designCode || t('telegramInvoice.notSpecified');
    const color = item.colorName || item.colorCode || t('telegramInvoice.notSpecified');
    const roll = item.rollNo || item.rollNumber || '-';
    return t('telegramInvoice.itemLine', {
      index: index + 1,
      material,
      design,
      color,
      roll,
      meters: formatNumber(item.quantity),
      weight: formatNumber(item.weightKg ?? item.weight ?? 0),
      price: formatMoney(item.unitPrice, currency),
      total: formatMoney(item.total, currency),
    });
  });

  const groupLines = summary.groups.map((group) =>
    t('telegramInvoice.groupLine', {
      material: group.materialName,
      design: group.designCode,
      colorCount: group.colorCount,
      rollCount: group.rollCount,
      meters: formatNumber(group.totalMeters),
      weight: formatNumber(group.totalKg),
      amount: formatMoney(group.totalAmount, currency),
    }),
  );

  const moreItemsLine = invoice.items.length > 20 ? t('telegramInvoice.moreItemsLine', { count: invoice.items.length }) : '';

  return `${headerIcon} ${title}
${isDraft ? `\n${t('telegramInvoice.draftWarning')}` : ''}

${t('telegramInvoice.invoiceNoLine', { no: invoiceNo })}
${t('telegramInvoice.dateLine', { date: invoice.date })}
${t('telegramInvoice.partyLine', { label: partyLabel, name: partyName || t('telegramInvoice.cashFallback') })}
${t('telegramInvoice.warehouseLine', { warehouse: invoice.warehouse || '-' })}
${t('telegramInvoice.currencyLine', { currency })}
${currency !== 'USD' && exchangeRateToUsd > 0 ? t('telegramInvoice.exchangeRateLine', { rate: exchangeRateToUsd }) : ''}
${t('telegramInvoice.statusLine', { status: arInvoicePaymentStatusCode(invoice.status) })}

${t('telegramInvoice.itemDetailsHeader')}
${itemLines.join('\n') || t('telegramInvoice.noItems')}
${moreItemsLine}

${t('telegramInvoice.materialsSummaryHeader')}
${groupLines.join('\n') || t('telegramInvoice.noSummary')}

${t('telegramInvoice.totalsHeader')}
${t('telegramInvoice.rollsCountLine', { count: summary.totals.rollCount })}
${t('telegramInvoice.totalMetersLine', { meters: formatNumber(summary.totals.totalMeters) })}
${t('telegramInvoice.totalWeightLine', { weight: formatNumber(summary.totals.totalKg) })}
${t('telegramInvoice.invoiceTotalLine', { amount: formatMoney(invoice.totalAmount, currency) })}
${currency !== 'USD' && totalUsd != null ? t('telegramInvoice.invoiceTotalUsdLine', { amount: formatMoney(totalUsd, 'USD') }) : ''}
${t('telegramInvoice.paidLine', { amount: formatMoney(invoice.paidAmount, currency) })}
${currency !== 'USD' && paidUsd != null ? t('telegramInvoice.paidUsdLine', { amount: formatMoney(paidUsd, 'USD') }) : ''}
${t('telegramInvoice.remainingLine', { amount: formatMoney(invoice.remainingAmount, currency) })}
${currency !== 'USD' && remainingUsd != null ? t('telegramInvoice.remainingUsdLine', { amount: formatMoney(remainingUsd, 'USD') }) : ''}
${t('telegramInvoice.groupsCountLine', { count: summary.totals.groupCount })}

${t('telegramInvoice.sentFromBrand', { brand: BRAND.name, tagline: BRAND.tagline, descriptionAr: BRAND.descriptionAr })}`;
}

/** نفس قالب كشف الفاتورة A4 — للطباعة والتصدير وتيليغرام */
export function formatTelegramInvoicePdfHtml({ invoice, partyName }: TelegramInvoicePayload): string {
  return buildTelegramInvoiceHtml(invoice as Invoice, partyName);
}

/** إرسال تيليغرام بفاتورة كاملة (نفس كائن التصدير بعد الحفظ) */
export async function sendTelegramInvoiceFromSavedInvoice(invoice: Invoice, partyName: string): Promise<void> {
  const invoiceType = invoice.type === 'purchase' ? 'purchase' : 'sale';
  await sendTelegramInvoiceNotification({ invoice, invoiceType, partyName });
}

export async function sendTelegramInvoiceNotification(payload: TelegramInvoicePayload): Promise<void> {
  const isDraft = payload.invoice.documentStatus === 'DRAFT';
  const message = formatTelegramInvoiceMessage(payload);
  const pdfHtml = formatTelegramInvoicePdfHtml(payload);
  const invoiceNo = payload.invoice.invoiceNumber || payload.invoice.id || 'invoice';
  const partyName = payload.partyName || (payload.invoiceType === 'sale' ? t('telegramInvoice.customerFallback') : t('telegramInvoice.supplierFallback'));
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
    caption: isDraft
      ? payload.invoiceType === 'sale'
        ? t('telegramInvoice.captionDraftSale')
        : t('telegramInvoice.captionDraftPurchase')
      : payload.invoiceType === 'sale'
        ? t('telegramInvoice.captionSale')
        : t('telegramInvoice.captionPurchase'),
    eventType: payload.invoiceType === 'sale' ? 'SALE_INVOICE' : 'PURCHASE_INVOICE',
  });
}
