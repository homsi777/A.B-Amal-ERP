import { BRAND } from '../../branding';
import { amountToArabicWords } from './arabicAmountWords';
import {
  buildVoucherMetaStatement,
  buildVoucherNarrativeParts,
  type VoucherNarrativeInput,
} from './voucherNarrative';

const NAVY = '#2C405A';
const GOLD = '#C4A962';
const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";

const CONTACT = {
  location: 'الجمهورية العربية السورية / حلب',
  phone: '+963 944 555 080',
  receiptSlogan: 'ثقتكم رأسمالنا الحقيقي.',
  paymentSlogan: 'الالتزام في التعامل أساس الثقة بيننا',
} as const;

export type VoucherPrintData = {
  voucherNo: string;
  voucherType: 'RECEIPT' | 'PAYMENT';
  voucherDate: string;
  partyName: string;
  partyType?: string;
  amount: string;
  currencyCode: string;
  exchangeRateToUsd?: string;
  amountUsd?: string;
  cashboxName?: string;
  paymentMethod?: string | null;
  referenceDocumentNo?: string | null;
  description?: string | null;
  representative?: string | null;
};

export type VoucherRenderOptions = {
  colorMode?: 'color' | 'bw';
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function displayField(value?: string | null): string {
  const trimmed = String(value ?? '').trim();
  return trimmed ? esc(trimmed) : '—';
}

function normalizeVoucherDate(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  const datePart = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  return raw;
}

function shortNumericVoucherNo(voucherNo: string): string {
  const digits = String(voucherNo ?? '').match(/\d+/g)?.join('');
  return digits ? digits.padStart(6, '0').slice(-6) : '000000';
}

function formatAmountDisplay(amount: string, currencyCode: string): string {
  const num = Number(amount);
  const code = currencyCode.trim().toUpperCase() || 'USD';
  const formatted = Number.isFinite(num)
    ? num % 1 === 0
      ? String(Math.round(num))
      : num.toFixed(2)
    : String(amount ?? '0');
  return `${formatted} ${code}`;
}

function iconSvg(kind: 'user' | 'pin' | 'tag' | 'calendar' | 'wallet' | 'doc' | 'receipt' | 'phone' | 'mail' | 'check' | 'star' | 'shield'): string {
  const paths: Record<string, string> = {
    user: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z',
    pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z',
    tag: 'M3 10V3h7l10 10-7 7L3 10Zm4-4a1.5 1.5 0 1 0 1.5 1.5A1.5 1.5 0 0 0 7 6Z',
    calendar: 'M7 2v2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm12 8H5v8h14V10Z',
    wallet: 'M3 6h14a2 2 0 0 1 2 2v1h-3a3 3 0 0 0 0 6h3v1a2 2 0 0 1-2 2H3V6Zm14 4h2v2h-2a1 1 0 1 1 0-2Z',
    doc: 'M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V6h2.5',
    receipt: 'M6 2h12v18l-2-1-2 1-2-1-2 1-2-1-2 1-2-1V2Zm2 4h8v2H8V6Zm0 4h8v2H8v-2Z',
    phone: 'M7 3h3l1 4-2 1a11 11 0 0 0 5 5l1-2 4 1v3a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-2Z',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2 8 5 8-5v12H4V6Z',
    check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
    star: 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7-5.4-4.7 7.1-.6L12 2Z',
    shield: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z',
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

function renderVoucherFooterHtml(isReceipt: boolean): string {
  const slogan = isReceipt ? CONTACT.receiptSlogan : CONTACT.paymentSlogan;
  const sloganIcon = isReceipt ? iconSvg('star') : iconSvg('shield');
  const phoneHtml = `<span class="footer-phone ltr">${esc(CONTACT.phone)}</span>`;

  return `
      <div class="footer-bar">
        <table class="footer-table" dir="rtl">
          <tr>
            <td class="footer-right" style="width:34%;">
              <span class="footer-inline">${iconSvg('pin')}<span>${esc(CONTACT.location)}</span></span>
            </td>
            <td class="footer-center" style="width:32%;">
              <span class="footer-inline footer-inline-center">${iconSvg('phone')}${phoneHtml}</span>
            </td>
            <td class="footer-left" style="width:34%;">
              <span class="footer-inline">${sloganIcon}<span>${esc(slogan)}</span></span>
            </td>
          </tr>
        </table>
      </div>`;
}

function narrativeInput(data: VoucherPrintData): VoucherNarrativeInput {
  return {
    voucherType: data.voucherType,
    partyName: data.partyName,
    amount: Number(data.amount) || 0,
    currencyCode: data.currencyCode,
    paymentMethod: data.paymentMethod,
    cashboxName: data.cashboxName,
    referenceDocumentNo: data.referenceDocumentNo,
    description: data.description,
  };
}

function renderNarrativeHtml(data: VoucherPrintData, accent: string): string {
  const parts = buildVoucherNarrativeParts(narrativeInput(data));
  const highlight = parts.highlight
    ? `<strong style="color:${accent};">${esc(parts.highlight)}</strong>`
    : '';
  return `${esc(parts.beforeAmount)}<strong style="color:${accent};">${esc(parts.amount)}</strong>${esc(parts.middle)}${highlight}${esc(parts.after)}`;
}

function renderSignFieldsHtml(): string {
  return `
    <table class="sign-fields" dir="rtl">
      <tr><td class="sign-key">الاسم:</td><td class="sign-val sign-underline">&nbsp;</td></tr>
      <tr><td class="sign-key">التوقيع:</td><td class="sign-val sign-underline">&nbsp;</td></tr>
    </table>`;
}

function voucherStyles(accent: string, accentSoft: string, bw: boolean): string {
  const accentColor = bw ? '#111111' : accent;
  const accentBg = bw ? '#f5f5f5' : accentSoft;
  const footerBg = bw ? '#ffffff' : NAVY;
  const footerText = bw ? '#111111' : '#ffffff';
  const footerIcon = bw ? '#333333' : GOLD;
  const footerBorder = bw ? '2px solid #111' : 'none';

  return `
    @page { size: A5 portrait; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 148mm;
      min-height: 210mm;
      font-family: ${FONT};
      color: #111;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 148mm;
      min-height: 210mm;
      display: flex;
      flex-direction: column;
      padding: 7mm 8mm 0;
    }
    .page-content { flex: 1 1 auto; }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    .header-table td { vertical-align: middle; }
    .logo { height: 42px; width: auto; object-fit: contain; }
    .page-no { font-size: 9px; color: #64748b; text-align: left; direction: ltr; }
    .doc-title {
      text-align: center;
      font-size: 26px;
      font-weight: 900;
      color: ${accentColor};
      margin: 2px 0 6px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: ${accentBg};
      color: ${accentColor};
      border: 1px solid ${accentColor};
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 10px;
      font-weight: 800;
    }
    .status-wrap { text-align: center; margin-bottom: 8px; }
    .status-badge .ico { width: 12px; height: 12px; fill: ${accentColor}; }
    .accent-bar {
      height: 3px;
      background: ${accentColor};
      border-radius: 2px;
      margin-bottom: 10px;
    }
    .cards-table { width: 100%; border-collapse: separate; border-spacing: 6px 0; margin-bottom: 8px; }
    .cards-table td { width: 50%; vertical-align: top; }
    .card {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 8px 10px;
      min-height: 118px;
      background: #fff;
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-weight: 900;
      color: ${accentColor};
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
    }
    .card-head .ico { width: 13px; height: 13px; fill: ${accentColor}; }
    .meta-table { width: 100%; border-collapse: collapse; }
    .meta-label {
      font-size: 8.5px;
      color: #64748b;
      font-weight: 700;
      padding: 3px 0;
      white-space: nowrap;
      vertical-align: top;
      width: 38%;
    }
    .meta-label .ico {
      width: 11px; height: 11px; fill: #94a3b8;
      vertical-align: -2px; margin-inline-end: 3px;
    }
    .meta-value {
      font-size: 9px;
      font-weight: 800;
      color: #0f172a;
      padding: 3px 0;
      text-align: left;
      word-break: break-word;
    }
    .type-pill {
      display: inline-block;
      background: ${accentBg};
      color: ${accentColor};
      border: 1px solid ${accentColor};
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 8px;
      font-weight: 900;
    }
    .amount-box {
      border: 2px solid ${accentColor};
      border-radius: 12px;
      padding: 10px 12px;
      text-align: center;
      margin: 8px 0;
      background: ${bw ? '#fff' : accentBg};
    }
    .amount-label {
      font-size: 10px;
      font-weight: 800;
      color: ${accentColor};
      margin-bottom: 4px;
    }
    .amount-value {
      font-size: 30px;
      font-weight: 900;
      color: ${accentColor};
      line-height: 1.1;
      letter-spacing: 0.5px;
    }
    .amount-words {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #cbd5e1;
      font-size: 9px;
      color: #334155;
      font-weight: 700;
      line-height: 1.5;
    }
    .narrative-box {
      border: 1px solid #cbd5e1;
      border-right: 4px solid ${accentColor};
      border-radius: 8px;
      padding: 10px 12px;
      margin: 8px 0 10px;
      background: #fafafa;
    }
    .narrative-head {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-weight: 900;
      color: ${accentColor};
      margin-bottom: 6px;
    }
    .narrative-head .ico { width: 13px; height: 13px; fill: ${accentColor}; }
    .narrative-text {
      font-size: 10.5px;
      line-height: 1.65;
      color: #1e293b;
      font-weight: 600;
    }
    .sign-table { width: 100%; border-collapse: separate; border-spacing: 8px 0; }
    .sign-table td {
      width: 50%;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 8px 10px;
      vertical-align: top;
    }
    .sign-title {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 9px;
      font-weight: 900;
      color: ${accentColor};
      margin-bottom: 6px;
    }
    .sign-title .ico { width: 12px; height: 12px; fill: ${accentColor}; }
    .sign-fields { width: 100%; border-collapse: collapse; }
    .sign-key { font-size: 8.5px; color: #64748b; font-weight: 700; padding: 3px 0; width: 34%; }
    .sign-val { font-size: 8.5px; font-weight: 700; padding: 3px 0; }
    .sign-underline { border-bottom: 1px solid #94a3b8; min-width: 60px; }
    .footer-bar {
      background: ${footerBg};
      color: ${footerText};
      border-top: ${footerBorder};
      padding: 10px 12px;
      margin: 10px -8mm 0;
      width: calc(100% + 16mm);
      flex-shrink: 0;
    }
    .footer-bar, .footer-bar * {
      color: ${footerText} !important;
      -webkit-text-fill-color: ${footerText} !important;
    }
    .footer-table { width: 100%; border-collapse: collapse; }
    .footer-table td { vertical-align: middle; font-size: 7.5px; line-height: 1.55; font-weight: 700; }
    .footer-right { text-align: right; }
    .footer-center { text-align: center; }
    .footer-left { text-align: left; }
    .footer-inline {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
    }
    .footer-inline-center { justify-content: center; margin: 0 auto; }
    .footer-inline .ico {
      width: 11px;
      height: 11px;
      fill: ${footerIcon};
      flex-shrink: 0;
    }
    .footer-phone {
      color: ${footerText} !important;
      -webkit-text-fill-color: ${footerText} !important;
      text-decoration: none !important;
      font-weight: 800;
      letter-spacing: 0.2px;
      white-space: nowrap;
    }
    .footer-bar a,
    .footer-bar a:link,
    .footer-bar a:visited,
    .footer-bar a:hover,
    .footer-bar a:active {
      color: ${footerText} !important;
      text-decoration: none !important;
      pointer-events: none;
    }
    .ltr { direction: ltr; unicode-bidi: embed; }

    @media print {
      html, body {
        width: 148mm;
        margin: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .page { min-height: auto; overflow: visible; }
      .card, .amount-box, .narrative-box, .footer-bar, .status-badge, .type-pill {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  `;
}

/** أنماط html2canvas — نفس قواعد الطباعة، مصدر واحد مع القالب */
export const VOUCHER_A5_PDF_EXPORT_CSS = `
  html, body {
    width: 148mm !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .page {
    width: 148mm !important;
    min-height: 210mm !important;
    display: flex !important;
    flex-direction: column !important;
    padding: 7mm 8mm 0 !important;
    overflow: visible !important;
    background: #ffffff !important;
  }
  .page-content { flex: 1 1 auto !important; }
  .status-wrap { text-align: center !important; width: 100% !important; margin-bottom: 8px !important; }
  .status-badge {
    display: inline-block !important;
    text-align: center !important;
    white-space: nowrap !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .status-badge span, .status-text {
    display: inline !important;
    visibility: visible !important;
    opacity: 1 !important;
    color: inherit !important;
    -webkit-text-fill-color: inherit !important;
  }
  .card-head, .narrative-head, .sign-title {
    display: block !important;
    line-height: 1.4 !important;
  }
  .card-head span, .narrative-head span, .sign-title span {
    display: inline !important;
    vertical-align: middle !important;
  }
  .card-head img, .narrative-head img, .sign-title img,
  .meta-label img, .footer-inline img, .status-badge img {
    display: inline-block !important;
    vertical-align: middle !important;
  }
  .cards-table, .sign-table, .header-table, .meta-table, .footer-table {
    border-collapse: collapse !important;
  }
  .cards-table { border-collapse: separate !important; border-spacing: 6px 0 !important; }
  .sign-table { border-collapse: separate !important; border-spacing: 8px 0 !important; }
  .meta-table { table-layout: fixed !important; width: 100% !important; }
  .meta-label { width: 38% !important; }
  .meta-value { width: 62% !important; text-align: left !important; }
  .card, .amount-box, .narrative-box, .footer-bar,
  .status-badge, .type-pill, .doc-title, .amount-value {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .amount-box { border-width: 2px !important; border-style: solid !important; }
  .narrative-text { font-weight: 600 !important; }
  .footer-bar {
    flex-shrink: 0 !important;
    margin: 10px -8mm 0 !important;
    width: calc(100% + 16mm) !important;
  }
  .footer-bar, .footer-bar * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .footer-inline { display: inline-flex !important; align-items: center !important; }
  .ico, img.ico { display: inline-block !important; vertical-align: middle !important; }
`;

/** html2canvas لا يرسم SVG — نحوّلها لصور قبل الالتقاط */
export function prepareVoucherDocumentForCanvas(doc: Document): void {
  const svgs = Array.from(doc.querySelectorAll('[data-clotex-doc="voucher-a5"] svg, .page[data-clotex-doc="voucher-a5"] svg'));
  for (const svg of svgs) {
    try {
      const svgEl = svg as SVGSVGElement;
      const computed = doc.defaultView?.getComputedStyle(svgEl);
      const w = svgEl.getBoundingClientRect().width
        || parseFloat(computed?.width || '0')
        || 12;
      const h = svgEl.getBoundingClientRect().height
        || parseFloat(computed?.height || '0')
        || 12;
      const clone = svgEl.cloneNode(true) as SVGSVGElement;
      if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      const serialized = new XMLSerializer().serializeToString(clone);
      const img = doc.createElement('img');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
      img.className = svgEl.className?.toString() || 'ico';
      img.style.width = `${Math.max(w, 10)}px`;
      img.style.height = `${Math.max(h, 10)}px`;
      img.style.display = 'inline-block';
      img.style.verticalAlign = 'middle';
      svgEl.parentNode?.replaceChild(img, svgEl);
    } catch {
      // إبقاء SVG الأصلي
    }
  }
}

export const A5_CAPTURE_WIDTH_PX = Math.round((148 / 25.4) * 96);

export function renderVoucherA5BodyHtml(data: VoucherPrintData, options: VoucherRenderOptions = {}): string {
  const bw = options.colorMode === 'bw';
  const isReceipt = data.voucherType === 'RECEIPT';
  const accent = isReceipt ? '#059669' : '#dc2626';
  const accentSoft = isReceipt ? '#ecfdf5' : '#fef2f2';
  const accentColor = bw ? '#111111' : accent;
  const typeLabel = isReceipt ? 'قبض' : 'صرف';
  const docTitle = isReceipt ? 'سند قبض' : 'سند صرف';
  const statusText = isReceipt ? 'تم استلام المبلغ' : 'تم صرف المبلغ';
  const amountHeading = isReceipt ? 'المبلغ المستلم' : 'المبلغ المصروف';
  const partyCardTitle = isReceipt ? 'بيانات العميل' : 'بيانات المستفيد';
  const receiverTitle = isReceipt ? 'المستلم' : 'المستفيد';

  const voucherNo = esc(`#${shortNumericVoucherNo(data.voucherNo)}`);
  const voucherDate = esc(normalizeVoucherDate(data.voucherDate));
  const partyName = displayField(data.partyName);
  const cashboxName = displayField(data.cashboxName);
  const invoiceNo = displayField(data.referenceDocumentNo);
  const metaStatement = displayField(buildVoucherMetaStatement(narrativeInput(data)));
  const representative = displayField(data.representative);
  const amountDisplay = esc(formatAmountDisplay(data.amount, data.currencyCode));
  const amountWords = esc(amountToArabicWords(Number(data.amount) || 0, data.currencyCode));

  return `
    <div class="page" dir="rtl" data-clotex-doc="voucher-a5">
      <div class="page-content">
        <table class="header-table">
          <tr>
            <td style="width:34%;"><img src="${BRAND.logoInline}" alt="${esc(BRAND.name)}" class="logo" /></td>
            <td style="width:32%;"></td>
            <td style="width:34%;"><div class="page-no">1 / 1</div></td>
          </tr>
        </table>
        <div class="doc-title">${docTitle}</div>
        <div class="status-wrap">
          <div class="status-badge">${iconSvg('check')}<span class="status-text">${statusText}</span></div>
        </div>
        <div class="accent-bar"></div>

        <table class="cards-table">
          <tr>
            <td>
              <div class="card">
                <div class="card-head">${iconSvg('user')}<span>${partyCardTitle}</span></div>
                <table class="meta-table">
                  ${metaRow(iconSvg('user'), 'اسم الجهة', partyName)}
                  ${metaRow(iconSvg('receipt'), 'رقم الفاتورة', invoiceNo)}
                  ${metaRow(iconSvg('doc'), 'البيان', metaStatement)}
                  ${metaRow(iconSvg('user'), 'المندوب', representative)}
                </table>
              </div>
            </td>
            <td>
              <div class="card">
                <div class="card-head">${iconSvg('tag')}<span>بيانات السند</span></div>
                <table class="meta-table">
                  ${metaRow(iconSvg('tag'), 'رقم السند', `<span class="ltr">${voucherNo}</span>`)}
                  ${metaRow(iconSvg('calendar'), 'التاريخ', `<span class="ltr">${voucherDate}</span>`)}
                  ${metaRow(iconSvg('receipt'), 'نوع السند', `<span class="type-pill">${typeLabel}</span>`)}
                  ${metaRow(iconSvg('wallet'), 'الصندوق', cashboxName)}
                </table>
              </div>
            </td>
          </tr>
        </table>

        <div class="amount-box">
          <div class="amount-label">${amountHeading}</div>
          <div class="amount-value">${amountDisplay}</div>
          <div class="amount-words">${amountWords}</div>
        </div>

        <div class="narrative-box">
          <div class="narrative-head">${iconSvg('doc')}<span>البيان:</span></div>
          <div class="narrative-text">${renderNarrativeHtml(data, accentColor)}</div>
        </div>

        <table class="sign-table">
          <tr>
            <td>
              <div class="sign-title">${iconSvg('wallet')}<span>أمين الصندوق</span></div>
              ${renderSignFieldsHtml()}
            </td>
            <td>
              <div class="sign-title">${iconSvg('user')}<span>${receiverTitle}</span></div>
              ${renderSignFieldsHtml()}
            </td>
          </tr>
        </table>
      </div>

      ${renderVoucherFooterHtml(isReceipt)}
    </div>`;
}

export function renderVoucherA5Html(data: VoucherPrintData, options: VoucherRenderOptions = {}): string {
  const isReceipt = data.voucherType === 'RECEIPT';
  const accent = isReceipt ? '#059669' : '#dc2626';
  const bw = options.colorMode === 'bw';
  const body = renderVoucherA5BodyHtml(data, options);
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="format-detection" content="telephone=no,email=no,address=no" />
  <title>${isReceipt ? 'سند قبض' : 'سند صرف'}</title>
  <style>${voucherStyles(accent, isReceipt ? '#ecfdf5' : '#fef2f2', bw)}</style>
</head>
<body>${body}</body>
</html>`;
}

export function voucherRowToPrintData(voucher: {
  voucher_no: string;
  voucher_type: 'RECEIPT' | 'PAYMENT';
  voucher_date: string;
  party_name: string;
  party_type?: string | null;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd?: string | null;
  amount_usd?: string | null;
  cashbox_name?: string | null;
  payment_method?: string | null;
  description?: string | null;
  reference_document_no?: string | null;
}): VoucherPrintData {
  return {
    voucherNo: voucher.voucher_no,
    voucherType: voucher.voucher_type,
    voucherDate: voucher.voucher_date,
    partyName: voucher.party_name,
    partyType: voucher.party_type ?? undefined,
    amount: voucher.amount,
    currencyCode: voucher.currency_code,
    exchangeRateToUsd: voucher.exchange_rate_to_usd ?? undefined,
    amountUsd: voucher.amount_usd ?? undefined,
    cashboxName: voucher.cashbox_name ?? undefined,
    paymentMethod: voucher.payment_method,
    description: voucher.description,
    referenceDocumentNo: voucher.reference_document_no ?? undefined,
  };
}
