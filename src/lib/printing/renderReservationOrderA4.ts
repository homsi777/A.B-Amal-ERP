import type { Customer, CustomerOrder } from '../../types';
import { BRAND } from '../../branding';
import { displayCustomerOrderNumber, orderLineDesignNo } from '../orderDisplay';

function orderLineTotal(line: CustomerOrder['items'][0]): number {
  return line.length * line.price;
}

function orderGrandTotal(order: CustomerOrder): number {
  return order.items.reduce((sum, line) => sum + orderLineTotal(line), 0);
}

function orderTotalLength(order: CustomerOrder): number {
  return order.items.reduce((sum, line) => sum + line.length, 0);
}

const NAVY = '#2C405A';
const GOLD = '#C4A962';
const BORDER = '#cbd5e1';
const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";

const CONTACT = {
  email: 'bashir@clotexco.com',
  phones: ['+90541 977 7171', '+963 944 555 080'],
  taglineAr: 'أقمشة بجودة تصنع الفرق',
  location: 'الجمهورية العربية السورية / حلب',
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCurrency(amount: number, currency: string): string {
  const code = currency.trim() || 'USD';
  const value = amount.toFixed(2);
  if (code === 'USD') return `${value} $`;
  if (code === 'SAR') return `${value} ر.س`;
  return `${value} ${code}`;
}

function formatGregorianDate(dateIso: string): string {
  try {
    const d = new Date(dateIso.includes('T') ? dateIso : `${dateIso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return dateIso;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateIso;
  }
}

function renderHeaderDatesBox(orderDate: string, supplyDate: string | null): string {
  const supplyBlock = supplyDate
    ? `<div class="date-divider">${iconSvg('truck')}<span>موعد التوريد</span></div>
       <div class="date-main">${esc(supplyDate)}</div>`
    : '';
  return `
    <div class="date-box">
      <div class="date-box-label">${iconSvg('calendar')}<span>تاريخ الطلب</span></div>
      <div class="date-main">${esc(orderDate)}</div>
      ${supplyBlock}
    </div>`;
}

function displayField(value?: string | null): string {
  const trimmed = String(value ?? '').trim();
  return trimmed ? esc(trimmed) : '—';
}

/** يمنع تحويل الأرقام لروابط زرقاء على الجوال/PDF */
function footerContactText(value: string): string {
  return esc(value).replace(/[+0-9]/g, (ch) => `${ch}<span aria-hidden="true" style="font-size:0;line-height:0;">&#8203;</span>`);
}

function shippingLabel(warehouse?: string): string {
  const value = String(warehouse ?? '').trim();
  if (!value) return '';
  if (value === 'sub') return 'مستودع الجملة — شحن داخلي';
  if (value === 'main') return 'شحن داخلي';
  return value;
}

function colorDot(name?: string): string {
  const palette: Record<string, string> = {
    أحمر: '#ef4444',
    red: '#ef4444',
    أصفر: '#eab308',
    yellow: '#eab308',
    أزرق: '#3b82f6',
    blue: '#3b82f6',
    أخضر: '#22c55e',
    green: '#22c55e',
    أسود: '#1e293b',
    black: '#1e293b',
    أبيض: '#e2e8f0',
    white: '#e2e8f0',
    بني: '#92400e',
    brown: '#92400e',
    بيج: '#d4b896',
    beige: '#d4b896',
    كريم: '#fef3c7',
    cream: '#fef3c7',
  };
  const raw = (name || '').trim().toLowerCase();
  let fill = '#94a3b8';
  for (const [key, value] of Object.entries(palette)) {
    if (raw.includes(key)) {
      fill = value;
      break;
    }
  }
  return `<span class="color-dot" style="background:${fill};"></span>`;
}

function lineColorHtml(line: CustomerOrder['items'][0]): string {
  const code = (line.colorCode || '').trim();
  const name = (line.colorName || '').trim();
  const text = code && name ? `${code} - ${name}` : name || code || '—';
  return `${esc(text)}${colorDot(name || code)}`;
}

function lineImageHtml(imageUrl?: string | null): string {
  const src = String(imageUrl ?? '').trim();
  if (!src.startsWith('data:image/') && !src.startsWith('http://') && !src.startsWith('https://')) {
    return '<span class="no-img">—</span>';
  }
  const safeSrc = src.replace(/"/g, '&quot;');
  return `<img src="${safeSrc}" alt="" crossorigin="anonymous" class="line-img" />`;
}

function iconSvg(kind: 'user' | 'pin' | 'truck' | 'phone' | 'tag' | 'lock' | 'wallet' | 'calendar' | 'bag' | 'note' | 'receipt' | 'doc' | 'mail'): string {
  const paths: Record<string, string> = {
    user: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z',
    pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z',
    truck: 'M3 6h11v8H3V6Zm11 2h3l2 3v3h-5V8ZM6 18a2 2 0 1 0-2-2 2 2 0 0 0 2 2Zm10 0a2 2 0 1 0-2-2 2 2 0 0 0 2 2ZM5 16h12',
    phone: 'M7 3h3l1 4-2 1a11 11 0 0 0 5 5l1-2 4 1v3a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-2Z',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2 8 5 8-5v12H4V6Z',
    tag: 'M3 10V3h7l10 10-7 7L3 10Zm4-4a1.5 1.5 0 1 0 1.5 1.5A1.5 1.5 0 0 0 7 6Z',
    lock: 'M7 10V8a5 5 0 0 1 10 0v2h2v10H5V10Zm2 0h6V8a3 3 0 0 0-6 0Z',
    wallet: 'M3 6h14a2 2 0 0 1 2 2v1h-3a3 3 0 0 0 0 6h3v1a2 2 0 0 1-2 2H3V6Zm14 4h2v2h-2a1 1 0 1 1 0-2Z',
    calendar: 'M7 2v2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm12 8H5v8h14V10Z',
    bag: 'M7 7V5a5 5 0 0 1 10 0v2h3v14H4V7Zm2 0h6V5a3 3 0 0 0-6 0Z',
    note: 'M6 2h9l3 3v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V6h2.5',
    receipt: 'M6 2h12v18l-2-1-2 1-2-1-2 1-2-1-2 1-2-1V2Zm2 4h8v2H8V6Zm0 4h8v2H8v-2Z',
    doc: 'M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V6h2.5',
  };
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[kind]}"/></svg>`;
}

function metaRow(icon: string, label: string, value: string): string {
  return `
    <tr>
      <td class="meta-label">${icon}<span>${label}</span></td>
      <td class="meta-value">${value}</td>
    </tr>`;
}

function renderSignFieldsHtml(nameValue: string, emptyNameLine: boolean): string {
  const nameCell = emptyNameLine
    ? `<td class="sign-val sign-underline">&nbsp;</td>`
    : `<td class="sign-val">${nameValue}</td>`;
  return `
    <table class="sign-fields" dir="rtl">
      <tr>
        <td class="sign-key">الاسم:</td>
        ${nameCell}
      </tr>
      <tr>
        <td class="sign-key">التوقيع:</td>
        <td class="sign-val sign-underline">&nbsp;</td>
      </tr>
    </table>`;
}

function renderSignSectionHtml(
  customer: Customer,
  advancePayment: number,
  currency: string,
): string {
  const advanceText =
    advancePayment > 0 ? formatCurrency(advancePayment, currency) : '—';
  return `
      <table class="sign-table" dir="rtl">
        <thead>
          <tr>
            <th>موافقة العميل</th>
            <th>مندوب المبيعات — ${esc(BRAND.name)}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="sign-body">
              ${renderSignFieldsHtml(displayField(customer.name), false)}
              <div class="sign-note">يرجى مراجعة البيانات والتوقيع عند الموافقة</div>
            </td>
            <td class="sign-body">
              ${renderSignFieldsHtml('', true)}
              <div class="sign-advance-row">عربون: ${advanceText}</div>
            </td>
          </tr>
        </tbody>
      </table>`;
}

function buildGroupedItemRows(order: CustomerOrder, currency: string): string {
  const groups = order.items.reduce<
    Array<{ materialName: string; designNo: string; lines: CustomerOrder['items'] }>
  >((acc, line) => {
    const materialName = line.materialName || '—';
    const designNo = orderLineDesignNo(line);
    const existing = acc.find((g) => g.materialName === materialName && g.designNo === designNo);
    if (existing) existing.lines.push(line);
    else acc.push({ materialName, designNo, lines: [line] });
    return acc;
  }, []);

  let lineNo = 0;
  return groups
    .map((group) =>
      group.lines
        .map((line, index) => {
          lineNo += 1;
          const total = orderLineTotal(line);
          const isFirst = index === 0;
          const rowspan = group.lines.length;
          const groupCells = isFirst
            ? `<td class="material-name group-cell" rowspan="${rowspan}">${esc(group.materialName)}</td>
               <td class="mono group-cell" rowspan="${rowspan}">${esc(group.designNo)}</td>`
            : '';

          return `
        <tr>
          <td class="mono">${lineNo}</td>
          <td>${lineImageHtml(line.imageUrl)}</td>
          ${groupCells}
          <td class="color-cell">${lineColorHtml(line)}</td>
          <td class="mono">${line.length.toFixed(2)} <span style="font-size:9px;color:#64748b;">م</span></td>
          <td class="mono">${line.price.toFixed(2)}</td>
          <td class="mono total-cell">${formatCurrency(total, currency)}</td>
        </tr>`;
        })
        .join(''),
    )
    .join('');
}

function reservationStyles(): string {
  return `
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #0f172a;
      font-family: ${FONT};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      min-height: 297mm;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      max-width: 100%;
      margin: 0 auto;
      padding: 7mm 8mm 0;
      background: #fff;
      display: flex;
      flex-direction: column;
    }
    .page-content {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
    }
    .page-spacer {
      flex: 1 1 auto;
      min-height: 8mm;
    }
    .ico {
      width: 13px;
      height: 13px;
      fill: ${GOLD};
      vertical-align: -2px;
      margin-inline-end: 5px;
      flex-shrink: 0;
    }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    .header-table td { vertical-align: middle; padding: 0; }
    .logo-center {
      height: 96px;
      width: auto;
      max-width: 320px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .doc-title {
      font-size: 28px;
      font-weight: 900;
      color: ${NAVY};
      line-height: 1.1;
      margin: 0;
      text-align: right;
    }
    .doc-title-only { margin: 0; }
    .date-box {
      background: ${NAVY};
      color: #fff;
      border-radius: 8px;
      padding: 8px 10px;
      text-align: center;
    }
    .date-box-left {
      background: ${NAVY};
      color: #fff;
      border-radius: 8px;
      padding: 8px 10px;
      text-align: center;
    }
    .date-box-label {
      font-size: 8.5px;
      font-weight: 700;
      opacity: 0.92;
      text-align: center;
    }
    .date-box-label .ico { vertical-align: -2px; margin-inline-end: 3px; width: 11px; height: 11px; }
    .date-main { font-size: 10.5px; font-weight: 900; margin-top: 4px; line-height: 1.35; }
    .date-divider {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(255,255,255,0.2);
      font-size: 8.5px;
      font-weight: 700;
      opacity: 0.92;
    }
    .gold-bar {
      height: 3px;
      background: ${GOLD};
      border-radius: 2px;
      margin: 8px 0 8px;
    }
    .cards-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .cards-table > tbody > tr > td { width: 50%; vertical-align: top; padding: 0; }
    .cards-table > tbody > tr > td + td { padding-inline-start: 8px; }
    .card {
      border: 1px solid ${BORDER};
      border-radius: 6px;
      overflow: hidden;
      background: #fff;
    }
    .card-head {
      background: ${NAVY};
      color: #fff;
      padding: 5px 10px;
      font-weight: 800;
      font-size: 9px;
    }
    .card-head .ico { fill: ${GOLD}; vertical-align: -2px; margin-inline-end: 4px; width: 10px; height: 10px; }
    .meta-table { width: 100%; border-collapse: collapse; }
    .meta-label {
      width: 42%;
      padding: 4px 8px;
      font-size: 8px;
      font-weight: 800;
      color: #475569;
      background: #f8fafc;
      border-bottom: 1px solid ${BORDER};
      white-space: nowrap;
    }
    .meta-label .ico { width: 10px; height: 10px; margin-inline-end: 3px; }
    .meta-value {
      padding: 4px 8px;
      font-size: 8.5px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid ${BORDER};
    }
    .meta-table tr:last-child .meta-label,
    .meta-table tr:last-child .meta-value { border-bottom: none; }
    .status-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: #dcfce7;
      color: #15803d;
      font-weight: 800;
      font-size: 8px;
      white-space: nowrap;
    }
    .advance-box {
      margin: 6px 8px 8px;
      border: 1.5px solid #86efac;
      background: linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%);
      border-radius: 6px;
      padding: 7px 10px;
      text-align: center;
    }
    .advance-box-head {
      font-size: 8px;
      font-weight: 800;
      color: #15803d;
      margin-bottom: 3px;
    }
    .advance-box-head .ico { width: 11px; height: 11px; fill: ${GOLD}; vertical-align: -2px; margin-inline-end: 4px; }
    .advance-box-value {
      font-size: 12px;
      font-weight: 900;
      color: ${NAVY};
      font-family: Consolas, monospace;
      direction: ltr;
      unicode-bidi: embed;
    }
    .section-head {
      background: ${NAVY};
      color: #fff;
      padding: 11px 14px;
      font-weight: 800;
      font-size: 13px;
      border: 1px solid ${NAVY};
      border-bottom: none;
      border-radius: 8px 8px 0 0;
    }
    .section-head .ico { fill: ${GOLD}; vertical-align: -2px; margin-inline-end: 8px; width: 14px; height: 14px; }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid ${NAVY};
      font-size: 11px;
      margin-bottom: 10px;
      flex-shrink: 0;
    }
    .items-table th {
      background: ${NAVY};
      color: #fff;
      padding: 11px 7px;
      font-weight: 800;
      font-size: 11px;
      border: 1px solid ${NAVY};
      text-align: center;
    }
    .items-table td {
      padding: 10px 7px;
      border: 1px solid ${BORDER};
      text-align: center;
      vertical-align: middle;
      font-size: 11px;
    }
    .items-table tr:nth-child(even) td { background: #f8fafc; }
    .line-img {
      width: 52px;
      height: 52px;
      object-fit: cover;
      border-radius: 4px;
      border: 1px solid ${BORDER};
      display: block;
      margin: 0 auto;
      background: #fff;
    }
    .no-img { color: #cbd5e1; font-size: 10px; }
    .material-name { font-weight: 800; text-align: center !important; }
    .group-cell {
      vertical-align: middle !important;
      text-align: center !important;
      font-weight: 800;
      background: #fff !important;
    }
    .items-table tr:nth-child(even) td.group-cell { background: #fff !important; }
    .color-cell { font-weight: 700; text-align: right !important; }
    .color-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-inline-start: 6px;
      vertical-align: middle;
      border: 1px solid rgba(15,23,42,0.12);
    }
    .mono { font-family: Consolas, monospace; direction: ltr; unicode-bidi: embed; }
    .total-cell { font-weight: 900; background: #f1f5f9 !important; }
    .totals-table { width: 100%; border-collapse: separate; border-spacing: 8px 0; margin-bottom: 14px; }
    .totals-table td { width: 33.33%; vertical-align: middle; }
    .total-box {
      border: 1px solid ${BORDER};
      border-radius: 8px;
      padding: 14px 10px;
      text-align: center;
      background: #fff;
    }
    .total-box-label {
      font-size: 10px;
      color: #64748b;
      font-weight: 800;
      text-align: center;
    }
    .total-box-label .ico { vertical-align: -2px; margin-inline-end: 4px; }
    .total-box-value {
      font-size: 18px;
      font-weight: 900;
      color: ${NAVY};
      margin-top: 6px;
      font-family: Consolas, monospace;
    }
    .total-box-main {
      background: ${NAVY};
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 14px 10px;
      text-align: center;
    }
    .total-box-main .total-box-label { color: rgba(255,255,255,0.9); }
    .total-box-main .total-box-label .ico { fill: ${GOLD}; }
    .total-box-main .total-box-value { color: #fff; font-size: 20px; }
    .notes-box {
      border: 1px dashed ${BORDER};
      border-radius: 6px;
      padding: 6px 10px;
      margin-bottom: 10px;
    }
    .notes-title {
      font-weight: 800;
      color: ${NAVY};
      font-size: 9px;
      margin-bottom: 4px;
    }
    .notes-title .ico { vertical-align: -2px; margin-inline-end: 4px; width: 10px; height: 10px; }
    .notes-body {
      font-size: 9.5px;
      color: #475569;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .sign-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid ${BORDER};
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 14px;
      font-size: 11px;
      table-layout: fixed;
    }
    .sign-table th {
      background: ${NAVY};
      color: #fff;
      padding: 10px 8px;
      font-weight: 800;
      font-size: 11px;
      border: 1px solid ${NAVY};
      width: 50%;
      text-align: center;
    }
    .sign-table td.sign-body {
      padding: 12px 14px;
      vertical-align: top;
      border: 1px solid ${BORDER};
      height: 118px;
    }
    .sign-fields {
      width: 100%;
      border-collapse: collapse;
    }
    .sign-key {
      width: 48px;
      font-weight: 800;
      font-size: 11px;
      color: #0f172a;
      padding: 0 0 10px 8px;
      vertical-align: bottom;
      white-space: nowrap;
    }
    .sign-val {
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
      padding: 0 0 6px 0;
      vertical-align: bottom;
    }
    .sign-underline {
      border-bottom: 1px solid #94a3b8;
      min-height: 18px;
      line-height: 18px;
    }
    .sign-note {
      margin-top: 10px;
      padding-top: 8px;
      text-align: center;
      font-size: 9px;
      color: #64748b;
      font-weight: 600;
      line-height: 1.45;
    }
    .sign-advance-row {
      margin-top: 10px;
      padding-top: 8px;
      text-align: center;
      font-size: 10px;
      font-weight: 800;
      color: ${NAVY};
      direction: ltr;
      unicode-bidi: embed;
    }
    .footer-bar {
      background: ${NAVY};
      color: #fff;
      padding: 12px 16px;
      border-radius: 0;
      flex-shrink: 0;
      margin: 0 -8mm;
      width: calc(100% + 16mm);
    }
    .footer-bar,
    .footer-bar * {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
      text-decoration: none !important;
    }
    .footer-bar a,
    .footer-bar a:link,
    .footer-bar a:visited,
    .footer-bar a:hover,
    .footer-bar a:active {
      color: #ffffff !important;
      text-decoration: none !important;
      pointer-events: none;
    }
    .footer-table { width: 100%; border-collapse: collapse; }
    .footer-table td { vertical-align: middle; font-size: 8.5px; line-height: 1.65; }
    .footer-brand { font-weight: 900; letter-spacing: 0.4px; }
    .footer-tagline { opacity: 0.9; margin-top: 2px; font-size: 8px; }
    .footer-center { text-align: center; }
    .footer-contact-row {
      display: block;
      margin: 2px 0;
      white-space: nowrap;
    }
    .footer-contact-row .ico {
      width: 12px;
      height: 12px;
      fill: ${GOLD};
      vertical-align: -2px;
      margin-inline-end: 5px;
    }
    .footer-contact-text {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
      text-decoration: none !important;
      font-weight: 700;
    }
    .footer-location {
      text-align: right;
      font-weight: 700;
    }
    .footer-location .ico {
      width: 12px;
      height: 12px;
      fill: ${GOLD};
      vertical-align: -2px;
      margin-inline-end: 4px;
    }
    .footer-left { text-align: left; }
    .ltr { direction: ltr; unicode-bidi: embed; }
  `;
}

export function renderReservationOrderBodyHtml(
  order: CustomerOrder,
  customer: Customer,
  statusLabelAr: string,
): string {
  const totalPrice = orderGrandTotal(order);
  const totalLength = orderTotalLength(order);
  const advancePayment = Number(order.advancePayment || 0);
  const totalDue = Math.max(0, totalPrice - advancePayment);
  const orderDateGreg = formatGregorianDate(order.date);
  const expectedDateGreg = order.expectedDate ? formatGregorianDate(order.expectedDate) : null;
  const orderNo = displayCustomerOrderNumber(order.orderNumber);
  const customerPhone = displayField(customer.phone);
  const customerAddress = displayField(customer.address);
  const shippingMethod = displayField(shippingLabel(order.warehouse));
  const amountDueLabel = formatCurrency(totalDue, order.currency);
  const totalAmountLabel = formatCurrency(totalPrice, order.currency);
  const advanceLabel = advancePayment > 0 ? formatCurrency(advancePayment, order.currency) : '—';

  const itemRows = buildGroupedItemRows(order, order.currency);

  const notesBody = order.notes?.trim() ? esc(order.notes) : '—';

  const footerPhones = CONTACT.phones
    .map(
      (phone) =>
        `<div class="footer-contact-row">${iconSvg('phone')}<span class="footer-contact-text ltr">${footerContactText(phone)}</span></div>`,
    )
    .join('');

  const footerEmail = `<div class="footer-contact-row">${iconSvg('mail')}<span class="footer-contact-text ltr">${footerContactText(CONTACT.email)}</span></div>`;

  return `
    <div class="page" dir="rtl">
      <div class="page-content">
      <table class="header-table">
        <tr>
          <td style="width:24%;vertical-align:middle;">
            <h1 class="doc-title doc-title-only">أوردر</h1>
          </td>
          <td style="width:52%;text-align:center;vertical-align:middle;">
            <img src="${BRAND.logoInline}" alt="${esc(BRAND.name)}" class="logo-center" />
          </td>
          <td style="width:24%;vertical-align:middle;">
            ${renderHeaderDatesBox(orderDateGreg, expectedDateGreg)}
          </td>
        </tr>
      </table>
      <div class="gold-bar"></div>

      <table class="cards-table">
        <tr>
          <td>
            <div class="card">
              <div class="card-head">${iconSvg('user')}<span>بيانات العميل</span></div>
              <table class="meta-table">
                ${metaRow(iconSvg('user'), 'العميل', displayField(customer.name))}
                ${metaRow(iconSvg('phone'), 'رقم العميل', `<span class="ltr">${customerPhone}</span>`)}
                ${metaRow(iconSvg('pin'), 'العنوان', customerAddress)}
                ${metaRow(iconSvg('truck'), 'طريقة الشحن', shippingMethod)}
              </table>
            </div>
          </td>
          <td>
            <div class="card">
              <div class="card-head">${iconSvg('tag')}<span>بيانات الطلب</span></div>
              <table class="meta-table">
                ${metaRow(iconSvg('tag'), 'رقم الطلبية', `<span class="mono" style="font-weight:900;">${esc(orderNo)}</span>`)}
                ${metaRow(iconSvg('lock'), 'حالة الطلبية', `<span class="status-pill">${esc(statusLabelAr)}</span>`)}
                ${metaRow(iconSvg('wallet'), 'العملة', displayField(order.currency))}
              </table>
              <div class="advance-box">
                <div class="advance-box-head">${iconSvg('wallet')}<span>عربون</span></div>
                <div class="advance-box-value">${advanceLabel}</div>
              </div>
            </div>
          </td>
        </tr>
      </table>

      <div class="section-head">${iconSvg('bag')}<span>تفاصيل الأصناف المطلوبة</span></div>
      <table class="items-table">
        <thead>
          <tr>
            <th style="width:28px;">#</th>
            <th style="width:54px;">صورة</th>
            <th>اسم الخامة</th>
            <th>رقم الديزان</th>
            <th>اللون</th>
            <th>الأمتار</th>
            <th>سعر المتر</th>
            <th>إجمالي السعر</th>
          </tr>
        </thead>
        <tbody>${itemRows || '<tr><td colspan="8">—</td></tr>'}</tbody>
      </table>

      <table class="totals-table">
        <tr>
          <td>
            <div class="total-box">
              <div class="total-box-label">${iconSvg('doc')}<span>إجمالي الأمتار</span></div>
              <div class="total-box-value">${totalLength.toFixed(2)} م</div>
            </div>
          </td>
          <td>
            <div class="total-box-main">
              <div class="total-box-label">${iconSvg('receipt')}<span>إجمالي المبلغ</span></div>
              <div class="total-box-value">${totalAmountLabel}</div>
            </div>
          </td>
          <td>
            <div class="total-box">
              <div class="total-box-label">${iconSvg('wallet')}<span>المبلغ المطلوب</span></div>
              <div class="total-box-value">${amountDueLabel}</div>
            </div>
          </td>
        </tr>
      </table>

      <div class="notes-box">
        <div class="notes-title">${iconSvg('note')}<span>ملاحظات</span></div>
        <div class="notes-body">${notesBody}</div>
      </div>

      ${renderSignSectionHtml(customer, advancePayment, order.currency)}

      <div class="page-spacer"></div>
      </div>

      <div class="footer-bar">
        <table class="footer-table">
          <tr>
            <td class="footer-location" style="width:33%;">${iconSvg('pin')}<span>${esc(CONTACT.location)}</span></td>
            <td class="footer-center" style="width:34%;">
              ${footerEmail}
              ${footerPhones}
            </td>
            <td class="footer-left" style="width:33%;">
              <div class="footer-brand">${esc(BRAND.fullName)}</div>
              <div class="footer-tagline">${esc(CONTACT.taglineAr)}</div>
            </td>
          </tr>
        </table>
      </div>
    </div>`;
}

export function renderReservationOrderA4Document(
  order: CustomerOrder,
  customer: Customer,
  statusLabelAr: string,
): string {
  const title = `أوردر ${displayCustomerOrderNumber(order.orderNumber)}`;
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="format-detection" content="telephone=no,email=no,address=no" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${esc(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    ${reservationStyles()}
  </style>
</head>
<body>
  ${renderReservationOrderBodyHtml(order, customer, statusLabelAr)}
</body>
</html>`;
}
