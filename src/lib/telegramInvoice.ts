import { Invoice } from '../types';
import { calculateFabricInvoiceSummary } from './fabricInvoiceSummary';
import { BRAND } from '../branding';
import { arInvoicePaymentStatusCode } from './i18n/arTerminology';
import { sendTelegramDocument } from './api/telegramApi';

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

export function formatTelegramInvoicePdfHtml({ invoice, invoiceType, partyName }: TelegramInvoicePayload): string {
  const currency = invoice.currency || 'USD';
  const exchangeRateToUsd = currency === 'USD' ? 1 : Number(invoice.exchangeRateToUsd ?? 0);
  const totalUsd =
    currency === 'USD'
      ? invoice.totalAmount
      : invoice.totalAmountUsd ?? (exchangeRateToUsd > 0 ? invoice.totalAmount / exchangeRateToUsd : undefined);
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
  const title = invoiceType === 'sale' ? 'فاتورة بيع' : 'فاتورة شراء';
  const partyLabel = invoiceType === 'sale' ? 'العميل' : 'المورد';
  const invoiceNo = invoice.invoiceNumber || invoice.id || 'بدون رقم';
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));

  const itemRows = invoice.items.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${esc(item.materialName || item.fabricName || 'غير محدد')}</td>
      <td>${esc(item.designCode || 'غير محدد')}</td>
      <td>${esc(item.rollNo || item.rollNumber || '-')}</td>
      <td>${esc(item.colorName || item.colorCode || '-')}</td>
      <td class="num">${formatNumber(item.quantity)}</td>
      <td class="num">${formatNumber(item.weightKg ?? item.weight ?? 0)}</td>
      <td class="num">${formatMoney(item.unitPrice, currency)}</td>
      <td class="num total">${formatMoney(item.total, currency)}</td>
    </tr>
  `).join('');

  const summaryRows = summary.groups.map((group) => `
    <tr>
      <td>${esc(group.materialName)}</td>
      <td>${esc(group.designCode)}</td>
      <td class="num">${group.colorCount}</td>
      <td class="num">${group.rollCount}</td>
      <td class="num">${formatNumber(group.totalMeters)}</td>
      <td class="num">${formatNumber(group.totalKg)}</td>
      <td class="num total">${formatMoney(group.totalAmount, currency)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; font-family: "Arial", "Tahoma", sans-serif; color: #0f172a; direction: rtl; }
    .page { border: 1px solid #cbd5e1; padding: 22px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${BRAND.primaryColor}; padding-bottom: 16px; margin-bottom: 16px; }
    .brand { font-weight: 900; font-size: 26px; letter-spacing: 3px; color: ${BRAND.primaryColor}; }
    .brand-sub { font-size: 10px; letter-spacing: 5px; color: ${BRAND.primaryColorSoft}; margin-top: 4px; font-weight: 600; }
    .meta { text-align: left; font-size: 12px; line-height: 1.8; }
    h1 { margin: 0 0 6px; font-size: 26px; }
    h2 { margin: 20px 0 8px; font-size: 16px; }
    .info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px; border-radius: 6px; }
    .label { color: #64748b; font-size: 10px; font-weight: 700; }
    .value { margin-top: 3px; font-size: 13px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    th { background: #0f172a; color: #fff; padding: 7px; border: 1px solid #334155; }
    td { padding: 6px; border: 1px solid #cbd5e1; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .num { direction: ltr; text-align: left; font-family: Arial, sans-serif; }
    .total { font-weight: 900; color: #3730a3; }
    .totals { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 14px; }
    .signature { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 38px; }
    .sig { border-top: 2px solid #0f172a; padding-top: 8px; font-size: 12px; font-weight: 800; }
  </style>
</head>
<body>
  <main class="page">
    <section class="header">
      <div>
        <div class="brand">${BRAND.name}</div>
        <div class="brand-sub">${BRAND.tagline}</div>
        <h1>${title}</h1>
      </div>
      <div class="meta">
        <div>رقم الفاتورة: <b>${esc(invoiceNo)}</b></div>
        <div>التاريخ: <b>${esc(invoice.date)}</b></div>
        <div>العملة: <b>${esc(currency)}</b></div>
        ${currency !== 'USD' && exchangeRateToUsd > 0 ? `<div>سعر الصرف مقابل الدولار: <b>${esc(exchangeRateToUsd)}</b></div>` : ''}
        ${currency !== 'USD' && totalUsd != null ? `<div>الإجمالي بالدولار: <b>${esc(formatMoney(totalUsd, 'USD'))}</b></div>` : ''}
      </div>
    </section>
    <section class="info">
      <div class="box"><div class="label">${partyLabel}</div><div class="value">${esc(partyName || 'نقدي')}</div></div>
      <div class="box"><div class="label">المستودع</div><div class="value">${esc(invoice.warehouse || '-')}</div></div>
      <div class="box"><div class="label">المدفوع</div><div class="value">${formatMoney(invoice.paidAmount, currency)}</div></div>
      <div class="box"><div class="label">المتبقي</div><div class="value">${formatMoney(invoice.remainingAmount, currency)}</div></div>
    </section>
    <h2>تفاصيل الأصناف</h2>
    <table>
      <thead><tr><th>#</th><th>الخامة</th><th>التصميم</th><th>الرول</th><th>اللون</th><th>الأمتار</th><th>الوزن</th><th>السعر</th><th>الإجمالي</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <h2>ملخص الخامات</h2>
    <table>
      <thead><tr><th>الخامة</th><th>التصميم</th><th>الألوان</th><th>الرولات</th><th>الأمتار</th><th>الوزن</th><th>الإجمالي</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
    <section class="totals">
      <div class="box"><div class="label">الرولات</div><div class="value">${summary.totals.rollCount}</div></div>
      <div class="box"><div class="label">الأمتار</div><div class="value">${formatNumber(summary.totals.totalMeters)}</div></div>
      <div class="box"><div class="label">الوزن</div><div class="value">${formatNumber(summary.totals.totalKg)}</div></div>
      <div class="box"><div class="label">المجموعات</div><div class="value">${summary.totals.groupCount}</div></div>
      <div class="box"><div class="label">إجمالي الفاتورة</div><div class="value">${formatMoney(invoice.totalAmount, currency)}</div></div>
    </section>
    <section class="signature"><div class="sig">أعدّها</div><div class="sig">سلّمها</div><div class="sig">استلمها</div></section>
  </main>
</body>
</html>`;
}

export async function sendTelegramInvoiceNotification(payload: TelegramInvoicePayload): Promise<void> {
  const message = formatTelegramInvoiceMessage(payload);
  const pdfHtml = formatTelegramInvoicePdfHtml(payload);
  const invoiceNo = payload.invoice.invoiceNumber || payload.invoice.id || 'invoice';
  await sendTelegramDocument({
    documentType: 'INVOICE',
    partyType: payload.invoiceType === 'sale' ? 'customer' : 'supplier',
    partyId: payload.invoice.partyId || null,
    targetType: payload.invoiceType === 'sale' ? 'CUSTOMER' : 'SUPPLIER',
    targetId: payload.invoice.partyId || null,
    message,
    pdfHtml,
    fileName: `${invoiceNo}.pdf`,
    caption: payload.invoiceType === 'sale' ? 'فاتورة بيع PDF' : 'فاتورة شراء PDF',
    eventType: payload.invoiceType === 'sale' ? 'SALE_INVOICE' : 'PURCHASE_INVOICE',
  });
}
