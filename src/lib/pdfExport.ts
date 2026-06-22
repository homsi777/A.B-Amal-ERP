import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { BRAND } from '../branding';
import type { Invoice } from '../types';
import { resolveInvoiceDetailRowsForStatementRow } from './customerStatementInvoiceDetails';

/** CLOTEX brand header reused across all PDF statements. */
const renderBrandHeaderHtml = (): string => `
  <div dir="rtl" style="text-align:center;margin:0 0 4px;font-family:Arial,sans-serif;">
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;">
      <img src="${BRAND.logoInline}" alt="${BRAND.name}" style="height:145px;width:auto;object-fit:contain;" />
      <div style="display:none;line-height:1.05;">
        <div style="font-size:20px;font-weight:800;letter-spacing:0.5px;color:${BRAND.primaryColor};">${BRAND.name}</div>
        <div style="font-size:10px;letter-spacing:1.5px;color:${BRAND.primaryColorSoft};margin-top:4px;">${BRAND.tagline}</div>
      </div>
    </div>
    <div style="display:none;text-align:right;font-size:10px;font-weight:700;color:${BRAND.primaryColor};line-height:1.5;">
      <div style="font-size:11px;font-weight:800;">${BRAND.descriptionAr}</div>
      <div style="color:${BRAND.primaryColorSoft};font-weight:600;">إدارة مستودعات الأقمشة</div>
    </div>
  </div>
`;

export interface FabricStatementItem {
  date: string;
  fabricName: string;
  fabricCode: string;
  rollsCount: number;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  payments: number;
  remaining: number;
  invoiceRef: string;
}

export interface StatementTotals {
  itemCount: number;
  totalRolls: number;
  totalQuantity: number;
  totalAmount: number;
  totalPayments: number;
  totalRemaining: number;
}

export interface ExportData {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  fromDate: string;
  toDate: string;
  fabricItems: FabricStatementItem[];
  totals: StatementTotals;
  balance: {
    amount: number;
    type: string;
  };
  hideFinancialColumns?: boolean;
}

export interface SupplierStatementExportData {
  supplierName: string;
  supplierCompany: string;
  supplierPhone: string;
  fromDate: string;
  toDate: string;
  fabricItems: FabricStatementItem[];
  totals: StatementTotals;
  balance: {
    amount: number;
    type: string;
  };
  hideFinancialColumns?: boolean;
}

const PDF_CANVAS_SCALE = 1.35;
const PDF_JPEG_QUALITY = 0.78;
const PDF_SHARP_CANVAS_SCALE = 2;
const PDF_SHARP_JPEG_QUALITY = 0.92;

export type PdfExportOptions = {
  orientation?: 'portrait' | 'landscape';
  jpegQuality?: number;
  canvasScale?: number;
  containerWidth?: string;
  containerPadding?: string;
  pageFormat?: 'a4' | 'a5';
  /** ضغط المحتوى في صفحة A4 واحدة (طلبيات الحجز، كشف الفاتورة، …) */
  fitSinglePage?: boolean;
  /** هامش جانبي بالمليمتر عند التصدير — 0 لمستندات .page ذات هوامش مدمجة */
  pageMarginMm?: number;
};

/** تصدير PDF لمستندات A4 ذات تخطيط .page — يطابق معاينة الطباعة */
export const A4_FIXED_LAYOUT_PDF_OPTIONS: PdfExportOptions = {
  orientation: 'portrait',
  pageFormat: 'a4',
  containerWidth: '210mm',
  fitSinglePage: true,
  pageMarginMm: 0,
};

/** هوامش Electron صفرية — الهوامش مدمجة داخل HTML */
export const ELECTRON_A4_EMBEDDED_MARGINS = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
} as const;

const appendHtml2CanvasCompatibilityStyle = (doc: Document) => {
  const style = doc.createElement('style');
  style.setAttribute('data-pdf-export-compat', 'true');
  style.textContent = `
    html,
    body {
      color: #000000 !important;
      background: #ffffff !important;
      background-color: #ffffff !important;
      color-scheme: light !important;
    }

    #pdf-export-container,
    #pdf-export-container * {
      color-scheme: light !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }

    #pdf-export-container {
      color: #000000 !important;
      background: #ffffff !important;
      background-color: #ffffff !important;
    }

    #pdf-export-container td,
    #pdf-export-container th {
      overflow: visible !important;
      color: #000000 !important;
    }
  `;
  doc.head.appendChild(style);

  return () => {
    style.remove();
  };
};

const removeElement = (element: HTMLElement) => {
  if (element.parentElement) {
    element.parentElement.removeChild(element);
  }
};

const addCompressedImageToPDF = (pdf: jsPDF, imageData: string, x: number, y: number, width: number, height: number) => {
  pdf.addImage(imageData, 'JPEG', x, y, width, height, undefined, 'FAST');
};

const createPdfContainer = (width = '1200px') => {
  const container = document.createElement('div');
  container.id = 'pdf-export-container';
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = width;
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#000000';
  container.style.padding = '20px';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.direction = 'rtl';
  return container;
};

const renderFabricStatementHtml = (options: {
  title: string;
  subtitle: string;
  partyLabel: string;
  partyName: string;
  detailLine: string;
  fromDate: string;
  toDate: string;
  items: FabricStatementItem[];
  totals: StatementTotals;
  balance: { amount: number; type: string };
  totalLabel: string;
  paymentsLabel: string;
  remainingLabel: string;
  hideFinancialColumns?: boolean;
}) => {
  const isSupplier = options.title.includes('مورد');
  const balanceColor = isSupplier ? '#e11d48' : '#4f46e5';
  const balanceBgColor = isSupplier ? '#fff1f2' : '#e0e7ff';
  const privacyStyle = options.hideFinancialColumns ? `
    <style>
      .statement-summary-grid > div:nth-child(n + 4) {
        display: none !important;
      }
      .statement-items-table th:nth-child(n + 8),
      .statement-items-table td:nth-child(n + 8) {
        display: none !important;
      }
    </style>
  ` : '';
  const financialSummaryCards = options.hideFinancialColumns ? '' : `
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; font-weight: bold;">${options.totalLabel}</div>
        <div style="font-size: 24px; font-weight: bold; color: #22c55e;">${options.totals.totalAmount.toLocaleString('ar')}</div>
      </div>
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; font-weight: bold;">${options.paymentsLabel}</div>
        <div style="font-size: 24px; font-weight: bold; color: #10b981;">${options.totals.totalPayments.toLocaleString('ar')}</div>
      </div>
      <div style="background-color: ${balanceBgColor}; border: 2px solid ${balanceColor}; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: ${balanceColor}; margin-bottom: 4px; font-weight: bold;">الرصيد (${options.balance.type})</div>
        <div style="font-size: 24px; font-weight: bold; color: ${balanceColor};">${options.balance.amount.toLocaleString('ar')}</div>
      </div>
  `;
  const financialHeaderCells = options.hideFinancialColumns ? '' : `
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">السعر الواحد</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1; color: #2563eb;">المجموع</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1; color: #10b981;">${options.paymentsLabel}</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1; color: #dc2626;">${options.remainingLabel}</th>
  `;

  return `
    ${privacyStyle}
    ${renderBrandHeaderHtml()}
    <div style="text-align: right; margin-bottom: 20px;">
      <h1 style="margin: 0 0 10px 0; color: #0f172a; font-size: 28px;">${options.title}</h1>
      <p style="margin: 0; color: #64748b; font-size: 14px;">${options.subtitle}</p>
    </div>

    <div style="background-color: #f1f5f9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <div style="margin-bottom: 8px;">
        <strong style="color: #1e293b;">${options.partyLabel}:</strong> <span style="color: #475569;">${options.partyName}</span>
      </div>
      <div style="margin-bottom: 8px; color: #475569;">${options.detailLine}</div>
      <div style="margin-bottom: 8px;">
        <strong style="color: #1e293b;">من:</strong> <span style="color: #475569;">${options.fromDate}</span>
        <strong style="color: #1e293b;">إلى:</strong> <span style="color: #475569;">${options.toDate}</span>
      </div>
    </div>

    <div class="statement-summary-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;">
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; font-weight: bold;">عدد الخامات (أسطر)</div>
        <div style="font-size: 24px; font-weight: bold; color: #4f46e5;">${options.totals.itemCount}</div>
      </div>
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; font-weight: bold;">مجموع الأتواب</div>
        <div style="font-size: 24px; font-weight: bold; color: #7c3aed;">${options.totals.totalRolls.toLocaleString('ar')}</div>
      </div>
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; font-weight: bold;">مجموع الكميات</div>
        <div style="font-size: 24px; font-weight: bold; color: #2563eb;">${options.totals.totalQuantity.toLocaleString('ar')}</div>
      </div>
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; font-weight: bold;">${options.totalLabel}</div>
        <div style="font-size: 24px; font-weight: bold; color: #22c55e;">${options.totals.totalAmount.toLocaleString('ar')}</div>
      </div>
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; font-weight: bold;">${options.paymentsLabel}</div>
        <div style="font-size: 24px; font-weight: bold; color: #10b981;">${options.totals.totalPayments.toLocaleString('ar')}</div>
      </div>
      <div style="background-color: ${balanceBgColor}; border: 2px solid ${balanceColor}; padding: 12px; border-radius: 8px; text-align: center;">
        <div style="font-size: 11px; color: ${balanceColor}; margin-bottom: 4px; font-weight: bold;">الرصيد (${options.balance.type})</div>
        <div style="font-size: 24px; font-weight: bold; color: ${balanceColor};">${options.balance.amount.toLocaleString('ar')}</div>
      </div>
    </div>

    <table class="statement-items-table" style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px;">
      <thead>
        <tr style="background-color: #1e293b; color: #ffffff;">
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">التاريخ</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">المرجع</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">اسم الخامة</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">كود الخامة</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">عدد الأتواب</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">الكمية / الطول</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">الوحدة</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1;">السعر الواحد</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1; color: #2563eb;">المجموع</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1; color: #10b981;">${options.paymentsLabel}</th>
          <th style="padding: 12px; text-align: center; border: 1px solid #cbd5e1; color: #dc2626;">${options.remainingLabel}</th>
        </tr>
      </thead>
      <tbody>
        ${options.items.map((item, idx) => `
          <tr style="background-color: ${idx % 2 === 0 ? '#f8fafc' : '#ffffff'};">
            <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1;">${item.date}</td>
            <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1;">${item.invoiceRef}</td>
            <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1;">${item.fabricName}</td>
            <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1;">${item.fabricCode}</td>
            <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1; font-weight: bold; color: #6d28d9;">${item.rollsCount.toLocaleString('ar')}</td>
            <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1;">${item.quantity.toLocaleString('ar')}</td>
            <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1;">${item.unit}</td>
            ${options.hideFinancialColumns ? '' : `
              <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1;">${item.unitPrice.toFixed(2)}</td>
              <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1; color: #2563eb; font-weight: bold;">${item.total.toLocaleString('ar')}</td>
              <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1; color: #10b981; font-weight: bold;">${item.payments.toLocaleString('ar')}</td>
              <td style="padding: 10px; text-align: center; border: 1px solid #cbd5e1; color: #dc2626; font-weight: bold;">${item.remaining.toLocaleString('ar')}</td>
            `}
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
      <p style="margin: 0;font-weight:700;letter-spacing:2px;color:${BRAND.primaryColor};">${BRAND.name} — ${BRAND.tagline}</p>
      <p style="margin: 4px 0 0;">تم إنشاء هذا الكشف بواسطة ${BRAND.descriptionAr}</p>
      <p style="margin: 0; margin-top: 5px;">${new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
  `;
};

export const renderCustomerStatementPdfHtml = (data: ExportData) =>
  renderFabricStatementHtml({
    title: 'كشف حساب عميل',
    subtitle: BRAND.descriptionAr,
    partyLabel: 'العميل',
    partyName: data.customerName,
    detailLine: `جوال: ${data.customerPhone} | العنوان: ${data.customerAddress}`,
    fromDate: data.fromDate,
    toDate: data.toDate,
    items: data.fabricItems,
    totals: data.totals,
    balance: data.balance,
    totalLabel: 'الإجمالي المالي',
    paymentsLabel: 'الدفعات',
    remainingLabel: 'الباقي',
    hideFinancialColumns: data.hideFinancialColumns
  });

export const renderSupplierStatementPdfHtml = (data: SupplierStatementExportData) =>
  renderFabricStatementHtml({
    title: 'كشف حساب مورد',
    subtitle: BRAND.descriptionAr,
    partyLabel: 'المورد',
    partyName: data.supplierCompany,
    detailLine: `ممثل الشركة: ${data.supplierName} | رقم الاتصال: ${data.supplierPhone}`,
    fromDate: data.fromDate,
    toDate: data.toDate,
    items: data.fabricItems,
    totals: data.totals,
    balance: data.balance,
    totalLabel: 'إجمالي المشتريات',
    paymentsLabel: 'السداد',
    remainingLabel: 'الباقي للمورد',
    hideFinancialColumns: data.hideFinancialColumns
  });

type AccountStatementRow = {
  date: string;
  typeLabel: string;
  documentNo: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  currency: string;
  notes?: string | null;
  sourceId?: string;
  sourceType?: string;
  type?: string;
};

type AccountStatementInvoiceDetail = {
  fabricName: string;
  rollsCount: number;
  totalQuantity: number;
  unitPrice: number;
  totalAmount: number;
};

type AccountStatementTotals = {
  debit: number;
  credit: number;
  closingBalance: number;
};

function renderAccountStatementHtml(options: {
  title: string;
  subtitle: string;
  partyLabel: string;
  partyName: string;
  detailLine: string;
  fromDate: string;
  toDate: string;
  openingBalance: number;
  rows: AccountStatementRow[];
  totals: AccountStatementTotals;
  closingLabel: string;
  closingAmount: number;
  currency: string;
  invoiceDetailsBySourceId?: Record<string, AccountStatementInvoiceDetail[]>;
  invoiceDetailsByDocumentNo?: Record<string, AccountStatementInvoiceDetail[]>;
  saleInvoices?: Invoice[];
}) {
  console.log('[pdfRender] renderAccountStatementHtml called:', {
    rows: options.rows.length,
    saleInvoices: options.saleInvoices?.length ?? 0,
    mapSourceIdKeys: Object.keys(options.invoiceDetailsBySourceId ?? {}).length,
    mapDocNoKeys: Object.keys(options.invoiceDetailsByDocumentNo ?? {}).length,
    salesRows: options.rows.filter(r => r.sourceType === 'SALES_INVOICE' || r.type === 'SALES_INVOICE').length,
  });
  const fmt = (n: number) => n.toLocaleString('ar', { maximumFractionDigits: 2 });
  const currencySymbol = (code: string) => {
    const normalized = String(code ?? '').trim().toUpperCase();
    if (normalized === 'USD') return '$';
    if (normalized === 'EUR') return '€';
    if (normalized === 'TRY') return '₺';
    if (normalized === 'SAR') return 'ر.س';
    if (normalized === 'SYP') return 'ل.س';
    return normalized || '¤';
  };
  const safeText = (value: string) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  return `
    <style>
      @page {
        size: A4 portrait;
        margin: 8mm 7mm 9mm;
        @bottom-left { content: counter(page) " / " counter(pages); }
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; }
      .account-statement-a4, .account-statement-a4 * {
        box-shadow: none !important;
      }
      .account-statement-a4 {
        direction: rtl;
        font-family: Arial, Tahoma, "Segoe UI", sans-serif !important;
        padding: 0 1mm !important;
        font-size: 10px !important;
        line-height: 1.2 !important;
      }
      .account-statement-a4 table {
        width: 100% !important;
        border-collapse: collapse !important;
        table-layout: fixed !important;
        page-break-inside: auto !important;
      }
      .account-statement-a4 thead { display: table-header-group !important; }
      .account-statement-a4 tr { break-inside: avoid !important; page-break-inside: avoid !important; }
      .account-statement-a4 th {
        background: #fff !important;
        border: 1px solid #000 !important;
        padding: 4px 3px !important;
        font-size: 10.5px !important;
        line-height: 1.1 !important;
        font-weight: 900 !important;
      }
      .account-statement-a4 td {
        background: #fff !important;
        border: 1px solid #000 !important;
        padding: 4px 3px !important;
        font-size: 10px !important;
        line-height: 1.15 !important;
      }
      .account-statement-a4 h1 {
        font-size: 19px !important;
        line-height: 1 !important;
        color: #000 !important;
      }
      .account-statement-a4 .statement-print-footer {
        margin-top: 8px;
        border-top: 1px solid #000;
        padding-top: 4px;
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        font-weight: 900;
      }
      .account-statement-a4 > div:nth-of-type(1) {
        text-align: center !important;
      }
      .account-statement-a4 > div:nth-of-type(1) > div {
        justify-content: center !important;
      }
      .account-statement-a4 > div:nth-of-type(2) {
        border-bottom: 1px solid #000 !important;
        padding-bottom: 4px !important;
        margin-bottom: 6px !important;
      }
      .account-statement-a4 > div:nth-of-type(2) p {
        display: none !important;
      }
      .account-statement-a4 > div:nth-of-type(3) {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 0 !important;
        margin-bottom: 6px !important;
        border: 1px solid #000 !important;
      }
      .account-statement-a4 > div:nth-of-type(3) > div {
        min-width: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: #fff !important;
        padding: 5px 6px !important;
      }
      .account-statement-a4 > div:nth-of-type(3) > div:first-child {
        border-left: 1px solid #000 !important;
      }
      .account-statement-a4 > div:nth-of-type(3) > div div {
        font-size: 9.5px !important;
        margin-top: 2px !important;
        margin-bottom: 2px !important;
      }
      .account-statement-a4 > div:nth-of-type(3) > div div:nth-child(2) {
        font-size: 12px !important;
        font-weight: 900 !important;
      }
      @media print {
        .account-statement-a4 { padding: 0 !important; }
      }
    </style>
    <div class="account-statement-a4" style="direction: rtl; font-family: Arial, sans-serif; padding: 24px; color: #0f172a; font-size: 14px;">
      ${renderBrandHeaderHtml()}
      <div style="text-align: center; border-bottom: 2px solid ${BRAND.primaryColor}; padding-bottom: 12px; margin-bottom: 16px;">
        <h1 style="margin: 0; font-size: 22px; color: ${BRAND.primaryColor};">${safeText(options.title)}</h1>
        <p style="margin: 6px 0 0; font-size: 12px; color: #475569;">${safeText(options.subtitle)}</p>
      </div>

      <div style="display:flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px;">
        <div style="flex:1; min-width: 280px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #f8fafc;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 6px;">${safeText(options.partyLabel)}</div>
          <div style="font-size: 18px; font-weight: 700; color: #0f172a;">${safeText(options.partyName)}</div>
          <div style="font-size: 11px; color: #475569; margin-top: 4px;">${safeText(options.detailLine)}</div>
        </div>
        <div style="flex:1; min-width: 280px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #ffffff;">
          <div style="display:flex; justify-content: space-between; font-size: 12px; color: #64748b;">
            <span>الفترة</span>
            <span>من ${safeText(options.fromDate)} إلى ${safeText(options.toDate)}</span>
          </div>
          <div style="display:flex; justify-content: space-between; margin-top: 10px; font-size: 12px;">
            <span style="color:#334155;">الرصيد الافتتاحي</span>
            <span style="font-weight:700;">${fmt(options.openingBalance)} ${safeText(options.currency)}</span>
          </div>
          <div style="display:flex; justify-content: space-between; margin-top: 6px; font-size: 12px;">
            <span style="color:#334155;">إجمالي المدين</span>
            <span style="font-weight:700; color:#2563eb;">${fmt(options.totals.debit)} ${safeText(options.currency)}</span>
          </div>
          <div style="display:flex; justify-content: space-between; margin-top: 6px; font-size: 12px;">
            <span style="color:#334155;">إجمالي الدائن</span>
            <span style="font-weight:700; color:#10b981;">${fmt(options.totals.credit)} ${safeText(options.currency)}</span>
          </div>
          <div style="display:flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #e2e8f0; font-size: 14px;">
            <span style="font-weight:700; color:#0f172a;">الرصيد النهائي (${safeText(options.closingLabel)})</span>
            <span style="font-weight:800; color:${BRAND.primaryColor};">${fmt(options.closingAmount)} ${safeText(options.currency)}</span>
          </div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: #0f172a; color: #f8fafc;">
            <th style="padding: 12px; border: 1px solid #0b1220;">التاريخ</th>
            <th style="padding: 12px; border: 1px solid #0b1220;">النوع</th>
            <th style="padding: 12px; border: 1px solid #0b1220;">الرقم</th>
            <th style="padding: 12px; border: 1px solid #0b1220;">البيان</th>
            <th style="padding: 12px; border: 1px solid #0b1220; color:#93c5fd;">مدين</th>
            <th style="padding: 12px; border: 1px solid #0b1220; color:#86efac;">دائن</th>
            <th style="padding: 12px; border: 1px solid #0b1220;">الرصيد</th>
          </tr>
        </thead>
        <tbody>
          ${
            options.rows.length === 0
              ? `
                <tr>
                  <td colspan="7" style="padding: 18px; text-align: center; border: 1px solid #e2e8f0; color: #64748b; background: #ffffff;">
                    لا توجد حركات ضمن الفترة المحددة
                  </td>
                </tr>
              `
              : options.rows
                  .map(
                    (row, idx) => {
                      const detailRows = resolveInvoiceDetailRowsForStatementRow(
                        row,
                        options.saleInvoices ?? [],
                        {
                          invoiceDetailsBySourceId: options.invoiceDetailsBySourceId,
                          invoiceDetailsByDocumentNo: options.invoiceDetailsByDocumentNo,
                        },
                      );
                      const detailsHtml =
                        detailRows.length === 0
                          ? ''
                          : detailRows
                              .map(
                                (detail) => `
                                  <tr style="background:#fff;">
                                    <td colspan="7" style="padding:8px 12px; border:1px solid #e2e8f0; font-size:13px; line-height:1.6; color:#334155; text-align:right; direction:rtl;">
                                      <span style="display:inline-block; margin-left:14px; font-weight:700; color:#0f766e;">
                                        رقم الفاتورة: ${safeText(row.documentNo)}
                                      </span>
                                      <span style="display:inline-block; margin-left:14px; font-weight:700; color:#047857;">
                                        الخامة: ${safeText(detail.fabricName)}
                                      </span>
                                      <span style="display:inline-block; margin-left:14px; font-weight:700; color:#047857;">
                                        عدد الأثواب: ${safeText(detail.rollsCount.toLocaleString('ar'))}
                                      </span>
                                      <span style="display:inline-block; margin-left:14px; font-weight:700; color:#047857;">
                                        إجمالي الأطوال: ${safeText(detail.totalQuantity.toLocaleString('ar'))} م
                                      </span>
                                      <span style="display:inline-block; margin-left:14px; font-weight:700; color:#047857;">
                                        السعر: ${safeText(currencySymbol(row.currency))} ${safeText(detail.unitPrice.toLocaleString('ar', { maximumFractionDigits: 2 }))} /م
                                      </span>
                                      <span style="display:inline-block; font-weight:700; color:#047857;">
                                        إجمالي المبلغ: ${safeText(
                                          `${detail.totalAmount.toLocaleString('ar', { maximumFractionDigits: 2 })} ${row.currency}`,
                                        )}
                                      </span>
                                    </td>
                                  </tr>
                                `,
                              )
                              .join('');
                      return `
                      <tr style="background-color: ${idx % 2 === 0 ? '#f8fafc' : '#ffffff'};">
                        <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0;">${safeText(
                          row.date,
                        )}</td>
                        <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0;">${safeText(
                          row.typeLabel,
                        )}</td>
                        <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-family: monospace;">${safeText(
                          row.documentNo,
                        )}</td>
                        <td style="padding: 12px; text-align: right; border: 1px solid #e2e8f0;">${safeText(
                          row.description,
                        )}${row.notes && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(String(row.notes)) ? `<div style="font-size: 12px; color:#64748b; margin-top: 4px;">${safeText(String(row.notes))}</div>` : ''}</td>
                        <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; color:#2563eb; font-weight:700;">${fmt(
                          row.debit,
                        )}</td>
                        <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; color:#10b981; font-weight:700;">${fmt(
                          row.credit,
                        )}</td>
                        <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-weight:700; color:${row.balance >= 0 ? '#2563eb' : '#10b981'};">${fmt(
                          row.balance,
                        )}</td>
                      </tr>
                      ${detailsHtml}
                    `;
                    },
                  )
                  .join('')
          }
        </tbody>
      </table>

      <div style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0;font-weight:700;letter-spacing:2px;color:${BRAND.primaryColor};">${BRAND.name} — ${BRAND.tagline}</p>
        <p style="margin: 4px 0 0;">تم إنشاء هذا الكشف بواسطة ${BRAND.descriptionAr}</p>
      </div>
    </div>
  `;
}

export function renderCustomerAccountStatementPdfHtml(data: {
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  fromDate: string;
  toDate: string;
  openingBalance: number;
  rows: AccountStatementRow[];
  totals: AccountStatementTotals;
  invoiceDetailsBySourceId?: Record<string, AccountStatementInvoiceDetail[]>;
  invoiceDetailsByDocumentNo?: Record<string, AccountStatementInvoiceDetail[]>;
  saleInvoices?: Invoice[];
}) {
  const closing = data.totals.closingBalance;
  const closingLabel = closing >= 0 ? 'مدين' : 'دائن';
  return renderAccountStatementHtml({
    title: 'كشف حساب عميل (حركات مالية)',
    subtitle: BRAND.descriptionAr,
    partyLabel: 'العميل',
    partyName: data.customerName,
    detailLine: `جوال: ${data.customerPhone ?? '—'} | العنوان: ${data.customerAddress ?? '—'}`,
    fromDate: data.fromDate,
    toDate: data.toDate,
    openingBalance: data.openingBalance,
    rows: data.rows,
    totals: data.totals,
    closingLabel,
    closingAmount: Math.abs(closing),
    currency: data.rows[0]?.currency ?? 'USD',
    invoiceDetailsBySourceId: data.invoiceDetailsBySourceId,
    invoiceDetailsByDocumentNo: data.invoiceDetailsByDocumentNo,
    saleInvoices: data.saleInvoices,
  });
}

export function renderSupplierAccountStatementPdfHtml(data: {
  supplierCompany: string;
  supplierName?: string | null;
  supplierPhone?: string | null;
  fromDate: string;
  toDate: string;
  openingBalance: number;
  rows: AccountStatementRow[];
  totals: AccountStatementTotals;
}) {
  const closing = data.totals.closingBalance;
  const closingLabel = closing >= 0 ? 'دائن للمورد' : 'مدين لنا';
  return renderAccountStatementHtml({
    title: 'كشف حساب مورد (حركات مالية)',
    subtitle: BRAND.descriptionAr,
    partyLabel: 'المورد',
    partyName: data.supplierCompany,
    detailLine: `ممثل الشركة: ${data.supplierName ?? '—'} | رقم الاتصال: ${data.supplierPhone ?? '—'}`,
    fromDate: data.fromDate,
    toDate: data.toDate,
    openingBalance: data.openingBalance,
    rows: data.rows,
    totals: data.totals,
    closingLabel,
    closingAmount: Math.abs(closing),
    currency: data.rows[0]?.currency ?? 'USD',
  });
}

const waitForContainerImages = (container: HTMLElement) =>
  Promise.all(
    Array.from(container.querySelectorAll('img')).map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );

const saveContainerAsPDF = async (
  container: HTMLElement,
  filenamePrefix: string,
  options: PdfExportOptions = {},
) => {
  container.style.padding = options.containerPadding ?? '20px';
  document.body.appendChild(container);
  const cleanupCompatibilityStyle = appendHtml2CanvasCompatibilityStyle(document);

  const canvasScale = options.canvasScale ?? PDF_CANVAS_SCALE;
  const jpegQuality = options.jpegQuality ?? PDF_JPEG_QUALITY;
  const pageFormat = options.pageFormat ?? 'a4';

  try {
    await waitForContainerImages(container);

    const canvas = await html2canvas(container, {
      scale: canvasScale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowHeight: container.scrollHeight,
      height: container.scrollHeight,
      onclone: (clonedDocument) => {
        appendHtml2CanvasCompatibilityStyle(clonedDocument);
        const clonedContainer = clonedDocument.getElementById('pdf-export-container');
        if (clonedContainer) {
          clonedContainer.style.height = 'auto';
          clonedContainer.style.minHeight = '0';
          clonedContainer.style.overflow = 'visible';
        }
      },
    });

    removeElement(container);

    const imgData = canvas.toDataURL('image/jpeg', jpegQuality);
    const orientation =
      options.orientation ||
      (container.innerHTML.includes('TOPLAM TUTAR') ? 'portrait' : canvas.height > canvas.width ? 'portrait' : 'landscape');
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: pageFormat,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const sideMargin = options.fitSinglePage ? 5 : 0;
    const usablePageWidth = pageWidth - sideMargin * 2;
    const usablePageHeight = pageHeight - sideMargin * 2;

    let imgWidth = usablePageWidth;
    let imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (options.fitSinglePage && imgHeight > usablePageHeight) {
      imgHeight = usablePageHeight;
      imgWidth = (canvas.width * imgHeight) / canvas.height;
    }

    const xOffset = sideMargin + (usablePageWidth - imgWidth) / 2;

    if (options.fitSinglePage || imgHeight <= usablePageHeight) {
      addCompressedImageToPDF(pdf, imgData, xOffset, sideMargin, imgWidth, imgHeight);
    } else {
      let heightLeft = imgHeight;
      let position = 0;
      addCompressedImageToPDF(pdf, imgData, 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        addCompressedImageToPDF(pdf, imgData, 0, position, pageWidth, imgHeight);
        heightLeft -= pageHeight;
      }
    }

    const currentDate = new Date().toISOString().split('T')[0];
    pdf.save(`${filenamePrefix}_${currentDate}.pdf`);
  } finally {
    cleanupCompatibilityStyle();
    removeElement(container);
  }
};

/** تصدير PDF من مقطع HTML (طلبيات حجز، تقارير، …) */
export async function exportPdfFromHtmlString(
  html: string,
  filenamePrefix: string,
  options: PdfExportOptions = {},
): Promise<void> {
  const container = createPdfContainer(options.containerWidth ?? '1200px');
  container.innerHTML = html;
  try {
    await saveContainerAsPDF(container, filenamePrefix, options);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

const appendA4FixedLayoutExportStyle = (doc: Document) => {
  const style = doc.createElement('style');
  style.setAttribute('data-pdf-a4-fixed-layout', 'true');
  style.textContent = `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: #ffffff !important;
    }
    .page {
      margin: 0 auto !important;
      overflow: hidden !important;
    }
  `;
  doc.head.appendChild(style);
};

/** تصدير PDF من مستند HTML كامل (كشوف فواتير A4، …) بجودة أعلى وعرض صفحة صحيح. */
export async function exportHtmlDocumentToPdf(
  html: string,
  filenamePrefix: string,
  options: PdfExportOptions = {},
): Promise<void> {
  const pageFormat = options.pageFormat ?? 'a4';
  const containerWidth = options.containerWidth ?? (pageFormat === 'a5' ? '148mm' : '210mm');
  const fitSinglePage = options.fitSinglePage ?? false;
  const pageMarginMm = options.pageMarginMm ?? (fitSinglePage ? 0 : 4);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:absolute;left:-9999px;top:0;width:${containerWidth};border:0;`;
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error('تعذر تجهيز PDF');
  }

  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((resolve) => window.setTimeout(resolve, 220));

  if (fitSinglePage) {
    appendA4FixedLayoutExportStyle(doc);
  }

  const pageEl = doc.querySelector('.page') as HTMLElement | null;
  const target = fitSinglePage && pageEl ? pageEl : doc.body;
  const cleanupCompatibilityStyle = appendHtml2CanvasCompatibilityStyle(doc);

  const measureWidth = () =>
    Math.max(
      target.scrollWidth,
      target.offsetWidth,
      doc.documentElement.scrollWidth,
      doc.documentElement.offsetWidth,
    );

  const captureWidth = fitSinglePage ? Math.ceil(measureWidth()) : measureWidth() + 24;
  if (!fitSinglePage) {
    iframe.style.width = `${captureWidth}px`;
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }

  try {
    const canvas = await html2canvas(target, {
      scale: options.canvasScale ?? PDF_SHARP_CANVAS_SCALE,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: fitSinglePage ? captureWidth : undefined,
      height: fitSinglePage ? Math.ceil(target.scrollHeight || target.offsetHeight) : undefined,
      windowWidth: captureWidth,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
      onclone: (clonedDocument) => {
        appendHtml2CanvasCompatibilityStyle(clonedDocument);
        if (fitSinglePage) {
          appendA4FixedLayoutExportStyle(clonedDocument);
        }
        const clonedTarget =
          fitSinglePage && clonedDocument.querySelector('.page')
            ? (clonedDocument.querySelector('.page') as HTMLElement)
            : clonedDocument.body;
        if (clonedTarget) {
          clonedTarget.style.overflow = 'visible';
          if (!fitSinglePage) {
            clonedTarget.style.width = `${captureWidth}px`;
          }
        }
      },
    });

    const jpegQuality = options.jpegQuality ?? PDF_SHARP_JPEG_QUALITY;
    const imgData = canvas.toDataURL('image/jpeg', jpegQuality);
    const orientation = options.orientation ?? 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: pageFormat });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const usablePageWidth = pageWidth - pageMarginMm * 2;
    const usablePageHeight = pageHeight - pageMarginMm * 2;

    let imgWidth = usablePageWidth;
    let imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (fitSinglePage && imgHeight > usablePageHeight) {
      imgHeight = usablePageHeight;
      imgWidth = (canvas.width * imgHeight) / canvas.height;
    }

    const xOffset = pageMarginMm + (fitSinglePage ? Math.max(0, (usablePageWidth - imgWidth) / 2) : 0);

    if (fitSinglePage || imgHeight <= usablePageHeight) {
      addCompressedImageToPDF(pdf, imgData, xOffset, pageMarginMm, imgWidth, imgHeight);
    } else {
      let heightLeft = imgHeight;
      let position = 0;
      addCompressedImageToPDF(pdf, imgData, pageMarginMm, position, usablePageWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        addCompressedImageToPDF(pdf, imgData, pageMarginMm, position, usablePageWidth, imgHeight);
        heightLeft -= pageHeight;
      }
    }

    const currentDate = new Date().toISOString().split('T')[0];
    pdf.save(`${filenamePrefix}_${currentDate}.pdf`);
  } finally {
    cleanupCompatibilityStyle();
    document.body.removeChild(iframe);
  }
}

export const exportToPDF = async (data: ExportData) => {
  const container = createPdfContainer();
  container.innerHTML = renderCustomerStatementPdfHtml(data);

  try {
    await saveContainerAsPDF(container, `كشف_حساب_${data.customerName}`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
};

export const exportSupplierStatementToPDF = async (data: SupplierStatementExportData) => {
  const container = createPdfContainer();
  container.innerHTML = renderSupplierStatementPdfHtml(data);

  try {
    await saveContainerAsPDF(container, `كشف_حساب_${data.supplierCompany}`);
  } catch (error) {
    console.error('Error generating supplier PDF:', error);
    throw error;
  }
};

/** @deprecated import from `../lib/printing/renderVoucherA5` — re-exported for compatibility */
export {
  renderVoucherA5Html,
  renderVoucherA5BodyHtml,
  voucherRowToPrintData,
  type VoucherPrintData,
  type VoucherRenderOptions,
} from './printing/renderVoucherA5';

export { buildVoucherNarrativeParagraph, buildVoucherMetaStatement } from './printing/voucherNarrative';

/** Browser/Electron-safe PDF export for receipt/payment vouchers (A5). */
export async function exportVoucherToPdf(
  data: import('./printing/renderVoucherA5').VoucherPrintData,
  filenamePrefix: string,
  options?: import('./printing/renderVoucherA5').VoucherRenderOptions,
): Promise<void> {
  const { renderVoucherA5Html } = await import('./printing/renderVoucherA5');
  const html = renderVoucherA5Html(data, options);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:absolute;left:-9999px;top:0;width:148mm;height:210mm;border:0;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error('تعذر تجهيز PDF');
  }

  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((resolve) => window.setTimeout(resolve, 180));

  try {
    const { default: html2canvas } = await import('html2canvas');
    const { default: jsPDF } = await import('jspdf');
    const target = doc.body;
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: target.scrollWidth,
      height: target.scrollHeight,
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const y = imgHeight <= pageHeight ? Math.max(0, (pageHeight - imgHeight) / 2) : 0;
    pdf.addImage(imgData, 'JPEG', 0, y, imgWidth, Math.min(imgHeight, pageHeight));
    pdf.save(`${filenamePrefix}.pdf`);
  } finally {
    document.body.removeChild(iframe);
  }
}
