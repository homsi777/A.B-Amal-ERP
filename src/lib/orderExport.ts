import * as XLSX from 'xlsx';
import type { Customer, CustomerOrder } from '../types';
import { exportHtmlDocumentToPdf } from './pdfExport';
import { BRAND } from '../branding';
import { displayCustomerOrderNumber, orderLineColorLabel, orderLineDesignNo } from './orderDisplay';
import {
  renderReservationOrderA4Document,
  renderReservationOrderBodyHtml,
} from './printing/renderReservationOrderA4';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** إيقاع تصميم محاسبي هادئ — خطوط موحّدة */
const PDF_BORDER = '#cbd5e1';
const PDF_BORDER_STRONG = '#2C405A';
const PDF_HEADER_BG = '#2C405A';
const PDF_HEADER_TEXT = '#ffffff';
const PDF_ALT_ROW = '#f8fafc';
const PDF_TOTAL_FILL = '#f1f5f9';
const PDF_FONT = "Tahoma,Arial,'Segoe UI','Arabic Typesetting',sans-serif";

function formatOrderCurrency(amount: number, currency: string): string {
  const code = currency.trim() || 'USD';
  if (code === 'USD') return `$ ${amount.toFixed(2)}`;
  if (code === 'SAR') return `${amount.toFixed(2)} ر.س`;
  return `${amount.toFixed(2)} ${code}`;
}

/** صورة سطر الكارتيلا في PDF — لا تستخدم escapeHtml على src */
function renderOrderLineImageCell(imageUrl?: string | null): string {
  const src = String(imageUrl ?? '').trim();
  if (!src.startsWith('data:image/') && !src.startsWith('http://') && !src.startsWith('https://')) {
    return '<span style="color:#cbd5e1;font-size:10px;">—</span>';
  }
  const safeSrc = src.replace(/"/g, '&quot;');
  return `<img src="${safeSrc}" alt="" crossorigin="anonymous" style="width:46px;height:46px;object-fit:cover;border-radius:4px;border:1px solid ${PDF_BORDER};display:block;margin:0 auto;background:#fff;" />`;
}

/** رأس مستند الطلبية — شعار واحد فقط بدون تكرار النص */
function renderOrderDocumentHeader(title: string): string {
  return `
<div dir="rtl" style="max-width:760px;margin:0 auto 18px;font-family:${PDF_FONT};">
  <div style="border:1px solid ${PDF_BORDER};border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <div style="padding:22px 24px 14px;text-align:center;background:#fff;">
      <img src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" style="height:54px;width:auto;max-width:300px;object-fit:contain;display:inline-block;" />
    </div>
    <div style="background:${PDF_HEADER_BG};color:${PDF_HEADER_TEXT};text-align:center;padding:11px 20px;font-size:15px;font-weight:800;">
      ${escapeHtml(title)}
    </div>
    <div style="background:#f8fafc;color:#64748b;text-align:center;padding:6px 12px;font-size:10px;font-weight:600;border-top:1px solid ${PDF_BORDER};">
      ${escapeHtml(BRAND.descriptionAr)}
    </div>
  </div>
</div>`;
}

function renderOrderMetaGridHtml(
  order: CustomerOrder,
  customer: Customer,
  statusLabelAr: string,
): string {
  const warehouseLabel =
    order.warehouse === 'sub' ? 'مستودع الجملة' : 'المستودع الرئيسي';
  const expectedLabel = order.expectedDate ? formatPdfLocaleDate(order.expectedDate) : '—';
  const notesVal = order.notes?.trim() ? escapeHtml(order.notes) : '—';

  const cellLabel =
    'width:38%;padding:9px 12px;font-weight:800;color:#334155;background:#f8fafc;border:1px solid ' +
    PDF_BORDER +
    ';font-size:11px;';
  const cellValue =
    'padding:9px 12px;font-weight:600;color:#0f172a;border:1px solid ' + PDF_BORDER + ';font-size:11px;';

  return `
<table dir="rtl" style="width:760px;margin:0 auto 16px;border-collapse:collapse;font-family:${PDF_FONT};font-size:11px;">
  <tbody>
    <tr>
      <td style="${cellLabel}">العميل</td>
      <td style="${cellValue}">${escapeHtml(customer.name)}</td>
      <td style="${cellLabel}">رقم الطلبية</td>
      <td style="${cellValue};font-family:monospace;">${escapeHtml(order.orderNumber)}</td>
    </tr>
    <tr>
      <td style="${cellLabel}">تاريخ الطلب</td>
      <td style="${cellValue}">${escapeHtml(formatPdfLocaleDate(order.date))}</td>
      <td style="${cellLabel}">موعد التوريد</td>
      <td style="${cellValue}">${escapeHtml(expectedLabel)}</td>
    </tr>
    <tr>
      <td style="${cellLabel}">المستودع</td>
      <td style="${cellValue}">${escapeHtml(warehouseLabel)}</td>
      <td style="${cellLabel}">العملة</td>
      <td style="${cellValue}">${escapeHtml(order.currency)}</td>
    </tr>
    <tr>
      <td style="${cellLabel}">حالة الطلبية</td>
      <td style="${cellValue}">${escapeHtml(statusLabelAr)}</td>
      <td style="${cellLabel}">جوال العميل</td>
      <td style="${cellValue};direction:ltr;text-align:right;">${escapeHtml(customer.phone || '—')}</td>
    </tr>
    <tr>
      <td style="${cellLabel}">ملاحظات</td>
      <td colspan="3" style="${cellValue}">${notesVal}</td>
    </tr>
  </tbody>
</table>`;
}

function renderTotalsAccountingStripHtml(
  materialLinesCount: number,
  totalLength: number,
  totalWeight: number,
  totalPrice: number,
  currency: string,
  lengthUnitHint: string,
): string {
  return `
<table dir="rtl" style="width:100%;border-collapse:collapse;border:1px solid ${PDF_BORDER};margin-bottom:14px;font-family:${PDF_FONT};font-size:11px;background:#fff;">
  <thead>
    <tr style="background:#f3f4f6;">
      <th style="border:1px solid ${PDF_BORDER};padding:8px 6px;font-weight:800;color:#000;text-align:center;">إجمالي الخامات</th>
      <th style="border:1px solid ${PDF_BORDER};padding:8px 6px;font-weight:800;color:#000;text-align:center;">إجمالي الطول</th>
      <th style="border:1px solid ${PDF_BORDER};padding:8px 6px;font-weight:800;color:#000;text-align:center;">إجمالي الوزن</th>
      <th style="border:1px solid ${PDF_BORDER};padding:8px 6px;font-weight:800;color:#000;text-align:center;">إجمالي السعر</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border:1px solid ${PDF_BORDER};padding:11px 8px;text-align:center;font-weight:800;font-size:14px;color:#000;">${materialLinesCount}</td>
      <td style="border:1px solid ${PDF_BORDER};padding:11px 8px;text-align:center;font-weight:800;font-size:13px;color:#000;">${totalLength.toFixed(2)} <span style="font-size:10px;font-weight:600;color:#444;">(${escapeHtml(lengthUnitHint)})</span></td>
      <td style="border:1px solid ${PDF_BORDER};padding:11px 8px;text-align:center;font-weight:800;font-size:13px;color:#000;">${totalWeight.toFixed(2)}</td>
      <td style="border:1px solid ${PDF_BORDER};padding:11px 8px;text-align:center;font-weight:800;font-size:14px;color:#000;">${totalPrice.toFixed(2)} <span style="font-size:10px;font-weight:700;color:#333;">${escapeHtml(currency)}</span></td>
    </tr>
  </tbody>
</table>`;
}

/** شعار CLOTEX — قائمة التعبئة التفصيلية (شعار واحد) */
function renderTextoriaStyleLogoHtml(): string {
  return renderOrderDocumentHeader('قائمة التعبئة التفصيلية');
}

function formatPdfLocaleDate(dateIso: string): string {
  try {
    const d = new Date(dateIso.includes('T') ? dateIso : `${dateIso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? dateIso : d.toLocaleDateString('ar-SA');
  } catch {
    return dateIso;
  }
}

function renderOrderPackingListMetaHtml(order: CustomerOrder, customer: Customer, statusLabelAr: string): string {
  const shipAddr = customer.address?.trim() || '—';
  const warehouseShip =
    order.warehouse === 'sub'
      ? 'مستودع الجملة'
      : order.warehouse === 'main' || !order.warehouse
        ? 'المستودع الرئيسي'
        : escapeHtml(order.warehouse || '');
  const notesVal = order.notes?.trim() ? escapeHtml(order.notes) : '—';
  const invoiceSlot = `${escapeHtml(`— / ${formatPdfLocaleDate(order.updatedAt.slice(0, 10))}`)}`;

  const accountBanner = `
  <div style="border:2px solid ${PDF_BORDER};padding:16px 20px;margin:0 0 16px;text-align:center;background:#fafafa;">
    <div style="font-size:11px;color:#444;margin-bottom:8px;font-weight:800;letter-spacing:0.5px;">اسم الحساب / العميل</div>
    <div style="font-size:19px;font-weight:900;color:#000;line-height:1.35;font-family:${PDF_FONT};">${escapeHtml(customer.name)}</div>
    <div style="font-size:11px;color:#333;margin-top:10px;"><strong>جوال:</strong> ${escapeHtml(customer.phone)}</div>
  </div>`;

  return `
<div dir="rtl" style="direction:rtl;font-family:${PDF_FONT};color:#111;margin-bottom:16px;">
  ${renderTextoriaStyleLogoHtml()}
  <p dir="rtl" style="direction:rtl;unicode-bidi:embed;text-align:center;margin:0 0 14px;font-size:11px;color:#444;">مرجع الطلبية: <strong>${escapeHtml(order.orderNumber)}</strong></p>
  ${accountBanner}

  <table style="width:100%;border-collapse:collapse;border:1px solid ${PDF_BORDER};font-size:11px;background:#fff;">
    <tbody>
      <tr>
        <td style="width:50%;vertical-align:top;padding:0;border-inline-end:1px solid ${PDF_BORDER};">
          <table style="width:100%;border-collapse:collapse;height:100%;">
            <tbody>
              <tr>
                <td style="padding:16px 14px;vertical-align:top;min-height:140px;">
                  <strong style="display:block;margin-bottom:8px;color:#000;">عنوان الشحن:</strong>
                  <span style="font-weight:400;line-height:1.75;color:#111;">${escapeHtml(shipAddr)}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
        <td style="width:50%;vertical-align:top;padding:0;">
          <table style="width:100%;border-collapse:collapse;">
            <tbody>
              <tr>
                <td style="border-bottom:1px solid ${PDF_BORDER};padding:9px 14px;">
                  <strong style="color:#000;">رقم الطلبية — نوع العملية:</strong>
                  <span style="font-weight:400;margin-inline-start:6px;">${escapeHtml(order.orderNumber)} — ${escapeHtml(statusLabelAr)}</span>
                </td>
              </tr>
              <tr>
                <td style="border-bottom:1px solid ${PDF_BORDER};padding:9px 14px;">
                  <strong style="color:#000;">التاريخ:</strong>
                  <span style="font-weight:400;margin-inline-start:6px;">${escapeHtml(formatPdfLocaleDate(order.date))}</span>
                </td>
              </tr>
              <tr>
                <td style="border-bottom:1px solid ${PDF_BORDER};padding:9px 14px;">
                  <strong style="color:#000;">رقم وتاريخ الفاتورة:</strong>
                  <span style="font-weight:400;margin-inline-start:6px;">${invoiceSlot}</span>
                </td>
              </tr>
              <tr>
                <td style="border-bottom:1px solid ${PDF_BORDER};padding:9px 14px;">
                  <strong style="color:#000;">طريقة الشحن:</strong>
                  <span style="font-weight:400;margin-inline-start:6px;">${warehouseShip}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:9px 14px;">
                  <strong style="color:#000;">ملاحظات:</strong>
                  <span style="font-weight:400;margin-inline-start:6px;display:inline-block;margin-top:4px;line-height:1.55;">${notesVal}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>

  <p style="margin:10px 0 0;text-align:center;font-size:10px;color:#555;line-height:1.8;">
    <strong>متوقع التوريد:</strong> ${escapeHtml(order.expectedDate ? formatPdfLocaleDate(order.expectedDate) : '—')}
    &nbsp;&nbsp;|&nbsp;&nbsp;<strong>العملة:</strong> ${escapeHtml(order.currency)}
  </p>
</div>`;
}

export function orderLineTotal(line: CustomerOrder['items'][0]): number {
  return line.length * line.price;
}

export function orderGrandTotal(order: CustomerOrder): number {
  return order.items.reduce((s, i) => s + orderLineTotal(i), 0);
}

export function orderTotalLength(order: CustomerOrder): number {
  return order.items.reduce((s, i) => s + i.length, 0);
}

export function orderTotalWeight(order: CustomerOrder): number {
  return order.items.reduce((s, i) => s + i.weight, 0);
}

function renderPaymentSummaryHtml(totalPrice: number, advancePayment: number | undefined, currency: string): string {
  if (!advancePayment || advancePayment <= 0) return '';
  const remaining = Math.max(0, totalPrice - advancePayment);
  return `
<table dir="rtl" style="width:100%;border-collapse:collapse;border:1px solid ${PDF_BORDER};margin-bottom:14px;font-family:${PDF_FONT};font-size:11px;background:#fff;">
  <thead>
    <tr style="background:#f3f4f6;">
      <th style="border:1px solid ${PDF_BORDER};padding:8px 6px;font-weight:800;color:#000;text-align:center;">&#x627;&#x644;&#x625;&#x62C;&#x645;&#x627;&#x644;&#x64A; &#x627;&#x644;&#x643;&#x644;&#x64A;</th>
      <th style="border:1px solid ${PDF_BORDER};padding:8px 6px;font-weight:800;color:#000;text-align:center;">&#x627;&#x644;&#x62F;&#x641;&#x639;&#x629; &#x627;&#x644;&#x645;&#x642;&#x62F;&#x645;&#x629;</th>
      <th style="border:1px solid ${PDF_BORDER};padding:8px 6px;font-weight:800;color:#000;text-align:center;">&#x627;&#x644;&#x645;&#x628;&#x644;&#x63A; &#x627;&#x644;&#x645;&#x62A;&#x628;&#x642;&#x64A;</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border:1px solid ${PDF_BORDER};padding:11px 8px;text-align:center;font-weight:800;font-size:13px;color:#000;">${totalPrice.toFixed(2)} <span style="font-size:10px;color:#444;">${escapeHtml(currency)}</span></td>
      <td style="border:1px solid ${PDF_BORDER};padding:11px 8px;text-align:center;font-weight:800;font-size:13px;color:#1a6e1a;">${advancePayment.toFixed(2)} <span style="font-size:10px;color:#444;">${escapeHtml(currency)}</span></td>
      <td style="border:1px solid ${PDF_BORDER};padding:11px 8px;text-align:center;font-weight:800;font-size:14px;color:${remaining > 0 ? '#b91c1c' : '#1a6e1a'};">${remaining.toFixed(2)} <span style="font-size:10px;font-weight:700;color:#333;">${escapeHtml(currency)}</span></td>
    </tr>
  </tbody>
</table>`;
}

export function renderCustomerOrderPdfHtml(order: CustomerOrder, customer: Customer, statusLabelAr: string): string {
  const totalPrice = orderGrandTotal(order);
  const totalLength = orderTotalLength(order);
  const totalWeight = orderTotalWeight(order);
  const materialLinesCount = order.items.length;

  const lengthUnitHint =
    order.items.length && order.items.every((i) => i.unitType === 'yard')
      ? 'يارد'
      : order.items.length && order.items.every((i) => i.unitType === 'meter')
        ? 'متر'
        : 'طول';

  const rows = order.items
    .map((line, idx) => {
      const lt = orderLineTotal(line);
      const imgCell = line.imageUrl
        ? `<img src="${escapeHtml(line.imageUrl)}" alt="" crossorigin="anonymous" referrerpolicy="no-referrer" style="width:44px;height:44px;object-fit:cover;border-radius:3px;border:1px solid #bfbfbf;display:block;margin:0 auto;" />`
        : `<span style="color:#777;font-size:11px;">—</span>`;
      const rowBg = idx % 2 === 0 ? '#fafafa' : '#ffffff';
      const cellBorder = '1px solid #bfbfbf';
      return `
        <tr style="background-color:${rowBg};">
          <td style="padding:8px;border:${cellBorder};text-align:center;">${idx + 1}</td>
          <td style="padding:8px;border:${cellBorder};text-align:center;vertical-align:middle;">${imgCell}</td>
          <td style="padding:10px;border:${cellBorder};">${escapeHtml(line.referenceBarcode || '—')}</td>
          <td style="padding:10px;border:${cellBorder};">${escapeHtml(line.materialName)}</td>
          <td style="padding:10px;border:${cellBorder};font-family:monospace;">${escapeHtml(orderLineDesignNo(line))}</td>
          <td style="padding:10px;border:${cellBorder};">${escapeHtml(line.colorCode || '—')}</td>
          <td style="padding:10px;border:${cellBorder};">${escapeHtml(line.colorName || '—')}</td>
          <td style="padding:10px;border:${cellBorder};text-align:center;">${line.length.toFixed(2)}</td>
          <td style="padding:10px;border:${cellBorder};text-align:center;">${line.price.toFixed(2)}</td>
          <td style="padding:10px;border:${cellBorder};text-align:center;font-weight:800;color:#000;">${lt.toFixed(2)}</td>
          <td style="padding:10px;border:${cellBorder};text-align:center;">${line.weight.toFixed(2)}</td>
        </tr>`;
    })
    .join('');

  return `
    ${renderOrderPackingListMetaHtml(order, customer, statusLabelAr)}

    ${renderTotalsAccountingStripHtml(materialLinesCount, totalLength, totalWeight, totalPrice, order.currency, lengthUnitHint)}

    ${renderPaymentSummaryHtml(totalPrice, order.advancePayment, order.currency)}

    <table dir="rtl" style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;font-family:${PDF_FONT};border:1px solid ${PDF_BORDER};background:#fff;">
      <thead>
        <tr style="background:#222;color:#fff;">
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">#</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">صورة</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">مرجع / باركود</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">اسم الخامة</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">كود خامة</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">كود لون</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">لون</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">كمية</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">سعر</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">إجمالي</th>
          <th style="padding:10px;border:1px solid ${PDF_BORDER};font-weight:800;">وزن kg</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="text-align:center;font-size:10px;color:#666;margin-top:14px;padding-top:10px;border-top:1px solid ${PDF_BORDER};font-family:${PDF_FONT};">
      <p style="margin:0;font-weight:700;letter-spacing:2px;color:${BRAND.primaryColor};">${escapeHtml(BRAND.name)} — ${escapeHtml(BRAND.tagline)}</p>
      <p style="margin:2px 0 0;">${escapeHtml(BRAND.descriptionAr)}</p>
      <p style="margin:4px 0 0;">${escapeHtml(new Date().toLocaleDateString('ar-SA'))}</p>
    </div>
  `;
}

function renderClotexOrderPdfHtml(order: CustomerOrder, customer: Customer, statusLabelAr: string): string {
  return renderReservationOrderBodyHtml(order, customer, statusLabelAr);
}

/** HTML موحّد للطباعة ومعاينة PDF لطلبية الحجز */
export function renderCustomerOrderDocumentHtml(
  order: CustomerOrder,
  customer: Customer,
  statusLabelAr: string,
): string {
  return renderClotexOrderPdfHtml(order, customer, statusLabelAr);
}

/** طباعة مستند الطلبية بنفس تصميم PDF */
export async function printCustomerOrderDocument(
  order: CustomerOrder,
  customer: Customer,
  statusLabelAr: string,
): Promise<{ ok: boolean; error?: string }> {
  const fullHtml = renderReservationOrderA4Document(order, customer, statusLabelAr);
  const title = `طلبية ${displayCustomerOrderNumber(order.orderNumber)}`;

  const useElectronPrint =
    typeof window !== 'undefined' &&
    window.fabricApp?.isElectron === true &&
    typeof window.fabricApp.printHtml === 'function';

  if (useElectronPrint) {
    try {
      const settings = await window.fabricApp!.getSettings();
      const result = await window.fabricApp!.printHtml(fullHtml, {
        pageSize: 'A4',
        silent: Boolean(settings.silentA4PrintingEnabled),
        printerName: settings.defaultA4PrinterName ?? undefined,
        printBackground: true,
      });
      return result.ok ? { ok: true } : { ok: false, error: result.error || 'تعذرت الطباعة' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'تعذرت الطباعة' };
    }
  }

  const printWindow = window.open('', '_blank', 'width=980,height=900');
  if (!printWindow) {
    return { ok: false, error: 'اسمح بالنوافذ المنبثقة ثم أعد المحاولة' };
  }
  printWindow.document.write(fullHtml);
  printWindow.document.close();
  printWindow.onload = () => {
    window.setTimeout(() => {
      printWindow.print();
    }, 350);
  };
  return { ok: true };
}

export async function exportCustomerOrderPdf(order: CustomerOrder, customer: Customer, statusLabelAr: string): Promise<void> {
  const html = renderReservationOrderA4Document(order, customer, statusLabelAr);
  const safeName = order.orderNumber.replace(/[^\w\u0600-\u06FF-]/g, '_');
  await exportHtmlDocumentToPdf(html, `طلبية_${safeName}`, {
    pageFormat: 'a4',
    orientation: 'portrait',
    canvasScale: 2,
    jpegQuality: 0.92,
  });
}

export function exportCustomerOrderExcel(order: CustomerOrder, customer: Customer, statusLabelAr: string): void {
  const total = orderGrandTotal(order);
  const tl = orderTotalLength(order);
  const tw = orderTotalWeight(order);
  const headerRows: (string | number)[][] = [
    ['طلبية حجز', order.orderNumber],
    ['الحالة', statusLabelAr],
    ['تاريخ الطلب', order.date],
    ['العميل', customer.name],
    ['الجوال', customer.phone],
    ['العنوان', customer.address],
    ['العملة', order.currency],
    ['المستودع', order.warehouse === 'sub' ? 'مستودع الجملة' : 'المستودع الرئيسي'],
    ['متوقع التوريد', order.expectedDate || ''],
    ['ملاحظات', order.notes || ''],
    [],
    ['إجمالي الخامات (عدد البنود)', order.items.length],
    ['إجمالي الطول', tl],
    ['إجمالي الوزن (كجم)', tw],
    ['إجمالي السعر', total],
    [],
    ['#', 'صورة (رابط)', 'مرجع/باركود', 'اسم الخامة', 'كود خامة', 'كود لون', 'لون', 'كمية', 'سعر', 'إجمالي سطر', 'وزن kg'],
  ];

  const bodyRows = order.items.map((line, i) => [
    i + 1,
    line.imageUrl || '',
    line.referenceBarcode || '',
    line.materialName,
    orderLineDesignNo(line),
    line.colorCode,
    line.colorName,
    line.length,
    line.price,
    orderLineTotal(line),
    line.weight,
  ]);

  const footerRows: (string | number)[][] = [
    ['', '', '', '', '', '', '', '', 'الإجمالي', total, tw],
  ];

  const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...bodyRows, [], ...footerRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'طلبية');
  const fname = `${order.orderNumber.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`;
  XLSX.writeFile(wb, fname);
}

export function buildCustomerOrderWhatsAppText(order: CustomerOrder, customer: Customer, statusLabelAr: string): string {
  const total = orderGrandTotal(order);
  const tl = orderTotalLength(order);
  const tw = orderTotalWeight(order);
  const lines = [
    `📋 طلبية حجز: ${order.orderNumber}`,
    `العميل: ${customer.name}`,
    `الحالة: ${statusLabelAr}`,
    `تاريخ الطلب: ${order.date}`,
    `متوقع التوريد: ${order.expectedDate || '—'}`,
    `إجمالي الخامات (بنود): ${order.items.length}`,
    `إجمالي الطول: ${tl.toFixed(2)}`,
    `إجمالي الوزن: ${tw.toFixed(2)} كجم`,
    `إجمالي السعر (${order.currency}): ${total.toFixed(2)}`,
    '',
    'بنود مختصرة:',
    ...order.items.slice(0, 8).map((l, i) => `${i + 1}) ${l.materialName} — ${orderLineDesignNo(l)} — ${orderLineColorLabel(l)} — ${l.length} × ${l.price} = ${orderLineTotal(l).toFixed(2)}`),
    order.items.length > 8 ? `… و${order.items.length - 8} بنداً إضافياً` : '',
    '',
    `— من نظام ${BRAND.name} (${BRAND.tagline}) —`,
  ].filter(Boolean);
  return lines.join('\n');
}
