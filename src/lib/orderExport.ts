import * as XLSX from 'xlsx';
import type { Customer, CustomerOrder } from '../types';
import { exportPdfFromHtmlString } from './pdfExport';
import { BRAND } from '../branding';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** إيقاع تصميم محاسبي هادئ — خطوط سوداء موحّدة كأنظمة الطباعة القديمة */
const PDF_BORDER = '#000000';
const PDF_TOTAL_FILL = '#ffffff';
const PDF_TOTAL_HEADER_FILL = '#ffffff';
const PDF_FONT = "Arial,Tahoma,'Segoe UI','Arabic Typesetting',sans-serif";

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

/** شعار CLOTEX — رأس المستندات الرسمية (PDF) */
function renderTextoriaStyleLogoHtml(): string {
  const navy = BRAND.primaryColor;
  const soft = BRAND.primaryColorSoft;
  return `
<div dir="rtl" style="margin:0 auto 18px;width:760px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid ${navy};padding:10px 18px;font-family:Arial,sans-serif;">
  <div style="display:flex;align-items:center;gap:10px;">
    <img src="${BRAND.logoInline}" alt="${escapeHtml(BRAND.name)}" style="height:58px;width:auto;object-fit:contain;" />
    <div style="line-height:1.05;">
      <div style="font-size:24px;font-weight:800;letter-spacing:1px;color:${navy};">${BRAND.name}</div>
      <div style="font-size:10px;letter-spacing:2px;color:${soft};margin-top:4px;">${BRAND.tagline}</div>
    </div>
  </div>
  <div style="text-align:right;font-size:10.5px;font-weight:700;line-height:1.55;color:${navy};max-width:300px;">
    <div style="font-size:12px;font-weight:800;">${BRAND.descriptionAr}</div>
    <div style="color:${soft};font-weight:600;">هوية بصرية معتمدة</div>
  </div>
</div>`;
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
  <h2 dir="rtl" style="direction:rtl;unicode-bidi:embed;text-align:center;margin:0 0 10px;font-size:17px;font-weight:900;color:#000;letter-spacing:0.5px;font-family:${PDF_FONT};">&#x642;&#x627;&#x626;&#x645;&#x629; &#x627;&#x644;&#x62A;&#x639;&#x628;&#x626;&#x629; &#x627;&#x644;&#x62A;&#x641;&#x635;&#x64A;&#x644;&#x64A;&#x629;</h2>
  <p dir="rtl" style="direction:rtl;unicode-bidi:embed;text-align:center;margin:0 0 14px;font-size:11px;color:#444;">&#x645;&#x631;&#x62C;&#x639; &#x627;&#x644;&#x637;&#x644;&#x628;&#x64A;&#x629;: <strong>${escapeHtml(order.orderNumber)}</strong></p>
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
          <td style="padding:10px;border:${cellBorder};font-family:monospace;">${escapeHtml(line.dsamNumber)}</td>
          <td style="padding:10px;border:${cellBorder};">${escapeHtml(line.colorCode)}</td>
          <td style="padding:10px;border:${cellBorder};">${escapeHtml(line.colorName)}</td>
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
  const totalPrice = orderGrandTotal(order);
  const totalLength = orderTotalLength(order);
  const advancePayment = Number(order.advancePayment || 0);
  const totalDue = Math.max(0, totalPrice - advancePayment);
  const dateLabel = formatPdfLocaleDate(order.date);
  const countryLabel = order.warehouse === 'sub' ? 'مستودع الجملة' : 'المستودع الرئيسي';

  const groups = order.items.reduce<Array<{ materialName: string; dsamNumber: string; lines: CustomerOrder['items'] }>>(
    (acc, line) => {
      const materialName = line.materialName || '-';
      const dsamNumber = line.dsamNumber || '-';
      const existing = acc.find((group) => group.materialName === materialName && group.dsamNumber === dsamNumber);
      if (existing) {
        existing.lines.push(line);
      } else {
        acc.push({ materialName, dsamNumber, lines: [line] });
      }
      return acc;
    },
    [],
  );

  const rows = groups
    .map((group, groupIndex) => {
      const groupRows = group.lines
        .map((line, index) => {
          const total = orderLineTotal(line);
          const unit = line.unitType === 'yard' ? 'YD' : 'MT';
          const isFirstInGroup = index === 0;
          const isLastInGroup = index === group.lines.length - 1;
          const groupEdgeStyle = `${isFirstInGroup ? `border-top:3px solid ${PDF_BORDER};` : ''}${isLastInGroup ? `border-bottom:3px solid ${PDF_BORDER};` : ''}`;
          const groupCells =
            index === 0
              ? `
          <td rowspan="${group.lines.length}" style="width:120px;border:3px solid ${PDF_BORDER};padding:8px;text-align:center;vertical-align:middle;font-weight:900;font-size:13px;">${escapeHtml(group.materialName)}</td>
          <td rowspan="${group.lines.length}" style="width:120px;border:3px solid ${PDF_BORDER};padding:8px;text-align:center;vertical-align:middle;font-weight:900;font-size:13px;">${escapeHtml(group.dsamNumber)}</td>`
              : '';

          return `
        <tr style="page-break-inside:avoid;">
          ${groupCells}
          <td style="width:190px;border:1px solid ${PDF_BORDER};${groupEdgeStyle}padding:10px 8px;text-align:center;font-weight:800;font-size:13px;">${escapeHtml(line.colorName || line.colorCode || '-')}</td>
          <td style="width:74px;border:1px solid ${PDF_BORDER};${groupEdgeStyle}padding:10px 8px;text-align:center;font-weight:900;font-size:13px;">${line.length.toFixed(0)}</td>
          <td style="width:40px;border:1px solid ${PDF_BORDER};${groupEdgeStyle}padding:10px 4px;text-align:center;font-weight:900;font-size:13px;">${unit}</td>
          <td style="width:64px;border:1px solid ${PDF_BORDER};${groupEdgeStyle}padding:10px 6px;text-align:center;font-weight:800;"></td>
          <td style="width:52px;border:1px solid ${PDF_BORDER};${groupEdgeStyle}padding:10px 6px;text-align:center;font-weight:900;font-size:13px;">${line.price.toFixed(2)}</td>
          <td style="width:96px;border:1px solid ${PDF_BORDER};${groupEdgeStyle}padding:10px 7px;text-align:center;background:${PDF_TOTAL_FILL};font-weight:900;font-size:13px;">
            <span style="float:left;margin-left:4px;">${escapeHtml(order.currency === 'USD' ? '$' : order.currency)}</span>
            <span>${total.toFixed(2)}</span>
          </td>
        </tr>`;
        })
        .join('');
      const separator =
        groupIndex < groups.length - 1
          ? `<tr><td colspan="8" style="height:7px;padding:0;border-left:2px solid ${PDF_BORDER};border-right:2px solid ${PDF_BORDER};border-top:3px solid ${PDF_BORDER};border-bottom:3px solid ${PDF_BORDER};background:#ffffff;"></td></tr>`
          : '';
      return groupRows + separator;
    })
    .join('');

  return `
  <div dir="rtl" style="width:820px;margin:0 auto;background:#fff;color:#000;font-family:${PDF_FONT};font-size:12px;font-weight:700;">
    ${renderTextoriaStyleLogoHtml()}
    <h1 style="margin:0 0 2px;text-align:center;font-size:20px;font-weight:900;line-height:1.25;">استمارة الطلب</h1>
    <table dir="rtl" style="width:760px;margin:0 auto;border-collapse:collapse;border:2px solid ${PDF_BORDER};font-size:12px;">
      <tbody>
        <tr>
          <td rowspan="4" style="width:430px;border:2px solid ${PDF_BORDER};padding:18px 10px;text-align:center;vertical-align:middle;font-size:13px;"><strong>السيد/ة : </strong>${escapeHtml(customer.name)}</td>
          <td style="border:1px solid ${PDF_BORDER};padding:7px 8px;text-align:right;"><strong>التاريخ:</strong> ${escapeHtml(dateLabel)}</td>
        </tr>
        <tr><td style="border:1px solid ${PDF_BORDER};padding:7px 8px;text-align:right;"><strong>رقم النموذج :</strong> ${escapeHtml(order.orderNumber)}</td></tr>
        <tr><td style="border:1px solid ${PDF_BORDER};padding:7px 8px;text-align:right;"><strong>موعد التسليم :</strong> ${escapeHtml(order.expectedDate ? formatPdfLocaleDate(order.expectedDate) : statusLabelAr || '-')}</td></tr>
        <tr><td style="border:1px solid ${PDF_BORDER};padding:7px 8px;text-align:center;"><strong>البلد:</strong> ${escapeHtml(countryLabel)}</td></tr>
      </tbody>
    </table>
    <table dir="rtl" style="width:760px;margin:0 auto;border-collapse:collapse;font-size:12px;border-left:2px solid ${PDF_BORDER};border-right:2px solid ${PDF_BORDER};border-bottom:2px solid ${PDF_BORDER};">
      <thead>
        <tr>
          <th style="border:2px solid ${PDF_BORDER};padding:10px 6px;text-align:center;">الخامة</th>
          <th style="border:2px solid ${PDF_BORDER};padding:10px 6px;text-align:center;">رقم النقشة</th>
          <th style="border:2px solid ${PDF_BORDER};padding:10px 6px;text-align:center;">اللون</th>
          <th colspan="2" style="border:2px solid ${PDF_BORDER};padding:10px 6px;text-align:center;">الكمية</th>
          <th style="border:2px solid ${PDF_BORDER};padding:10px 6px;text-align:center;">الحالة</th>
          <th style="border:2px solid ${PDF_BORDER};padding:10px 6px;text-align:center;">السعر</th>
          <th style="border:2px solid ${PDF_BORDER};padding:10px 6px;text-align:center;">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <table dir="rtl" style="width:330px;margin:0 88px 18px auto;border-collapse:collapse;font-size:12px;">
      <tbody>
        <tr>
          <td style="width:150px;border:2px solid ${PDF_BORDER};background:#fff4ce;text-align:center;padding:5px;font-weight:900;">TOPLAM MT</td>
          <td style="width:180px;border:2px solid ${PDF_BORDER};background:${PDF_TOTAL_HEADER_FILL};text-align:center;padding:5px;font-weight:900;">TOPLAM TUTAR</td>
        </tr>
        <tr>
          <td style="border:2px solid ${PDF_BORDER};text-align:center;padding:10px;font-weight:900;font-size:14px;">${totalLength.toFixed(0)}</td>
          <td style="border:2px solid ${PDF_BORDER};background:${PDF_TOTAL_FILL};text-align:center;padding:10px;font-weight:900;font-size:14px;"><span style="float:left;">${escapeHtml(order.currency === 'USD' ? '$' : order.currency)}</span>${totalPrice.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
    <table dir="rtl" style="width:760px;margin:0 auto;border-collapse:collapse;border:2px solid ${PDF_BORDER};font-size:13px;">
      <tbody>
        <tr>
          <td style="width:50%;border:2px solid ${PDF_BORDER};text-align:center;padding:9px;font-weight:900;">موافقة العميل</td>
          <td style="width:50%;border:2px solid ${PDF_BORDER};text-align:center;padding:9px;font-weight:900;">مقدم العرض / مستلم الطلب</td>
        </tr>
        <tr>
          <td style="border:2px solid ${PDF_BORDER};height:112px;padding:18px 28px;vertical-align:top;"><div>الاسم الكامل : ${escapeHtml(customer.name)}</div><div style="margin-top:22px;">التوقيع :</div><div style="margin-top:26px;text-align:center;font-weight:900;">"يرجى مراجعة المعلومات والتأكد من صحتها"</div></td>
          <td style="border:2px solid ${PDF_BORDER};height:112px;padding:18px 28px;vertical-align:top;"><div>الاسم الكامل : مدير النظام</div><div style="margin-top:22px;">التوقيع :</div><div style="margin-top:28px;text-align:center;color:#000;font-weight:900;">عيون : ${totalDue.toFixed(2)} ${escapeHtml(order.currency)}</div></td>
        </tr>
      </tbody>
    </table>
    <div style="height:18px;"></div>
  </div>`;
}

export async function exportCustomerOrderPdf(order: CustomerOrder, customer: Customer, statusLabelAr: string): Promise<void> {
  const html = renderClotexOrderPdfHtml(order, customer, statusLabelAr);
  const safeName = order.orderNumber.replace(/[^\w\u0600-\u06FF-]/g, '_');
  await exportPdfFromHtmlString(html, `طلبية_${safeName}`);
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
    line.dsamNumber,
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
    ...order.items.slice(0, 8).map((l, i) => `${i + 1}) ${l.materialName} — ${l.dsamNumber} — ${l.length} × ${l.price} = ${orderLineTotal(l).toFixed(2)}`),
    order.items.length > 8 ? `… و${order.items.length - 8} بنداً إضافياً` : '',
    '',
    `— من نظام ${BRAND.name} (${BRAND.tagline}) —`,
  ].filter(Boolean);
  return lines.join('\n');
}
