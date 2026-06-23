import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { BRAND } from '../branding';
import type { Invoice } from '../types';
import { flattenAccountStatementDisplayRows } from './customerStatementInvoiceDetails';
import { buildCustomerStatementFileName, buildSupplierStatementFileName } from './printing/documentFileNames';
import { documentFooterStyles, renderDocumentFooterHtml } from './printing/renderDocumentFooter';

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

  // ── Helpers ──────────────────────────────────────────────────────────────
  const fmt = (n: number) =>
    Number.isFinite(n) ? n.toLocaleString('ar', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
  const safeText = (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  // ── Palette ───────────────────────────────────────────────────────────────
  const NAVY   = BRAND.primaryColor;
  const GREEN  = '#15803d';
  const RED    = '#b91c1c';
  const BLUE   = '#1d4ed8';
  const DASH   = '—';

  // ── Parse detailLine → phone / address ───────────────────────────────────
  const [phonePart = '', addressPart = ''] = options.detailLine.split(' | ');

  let totalFabricAmount = 0;
  let totalFabricLength = 0;
  let totalFabricRolls = 0;

  const td = (content: string, extra = '') =>
    `<td style="padding:7px 6px;border:1px solid #e5e7eb;text-align:center;font-size:10px;vertical-align:middle;color:#000000;${extra}">${content}</td>`;

  const renderDataRow = (
    evBg: string,
    cols: {
      date: string;
      docNo: string;
      typeLabel: string;
      fabric: AccountStatementInvoiceDetail | null;
      debit: number | null;
      credit: number | null;
      balance: number | null;
    },
  ) => `<tr style="background:${evBg};">
    ${td(cols.date, 'white-space:nowrap;')}
    ${td(cols.docNo, 'font-family:monospace;font-size:9.5px;font-weight:600;')}
    ${td(cols.typeLabel)}
    ${td(cols.fabric ? safeText(cols.fabric.fabricName) : DASH)}
    ${td(cols.fabric ? cols.fabric.rollsCount.toLocaleString('ar') : DASH)}
    ${td(cols.fabric ? fmt(cols.fabric.totalQuantity) : DASH)}
    ${td(cols.fabric ? fmt(cols.fabric.unitPrice) : DASH)}
    ${td(cols.fabric ? `${safeText(options.currency)} ${fmt(cols.fabric.totalAmount)}` : DASH, 'font-weight:600;')}
    ${td(cols.debit != null && cols.debit > 0 ? fmt(cols.debit) : DASH, `color:${GREEN};font-weight:700;`)}
    ${td(cols.credit != null && cols.credit > 0 ? fmt(cols.credit) : DASH, `color:${RED};font-weight:700;`)}
    ${td(cols.balance != null ? fmt(Math.abs(cols.balance)) : DASH, `color:${BLUE};font-weight:700;`)}
  </tr>`;

  const bodyHtml = (() => {
    if (options.rows.length === 0) {
      return `<tr>
        <td colspan="11" style="padding:20px;text-align:center;color:#64748b;border:1px solid #e2e8f0;">
          لا توجد حركات ضمن الفترة المحددة
        </td>
      </tr>`;
    }

    const displayRows = flattenAccountStatementDisplayRows({
      rows: options.rows,
      openingBalance: options.openingBalance,
      saleInvoices: options.saleInvoices,
      invoiceDetailsBySourceId: options.invoiceDetailsBySourceId,
      invoiceDetailsByDocumentNo: options.invoiceDetailsByDocumentNo,
    });

    const parts: string[] = [];
    displayRows.forEach((row, displayIdx) => {
      if (row.fabric) {
        totalFabricAmount += row.fabric.totalAmount;
        totalFabricLength += row.fabric.totalQuantity;
        totalFabricRolls += row.fabric.rollsCount;
      }
      const evBg = displayIdx % 2 === 0 ? '#ffffff' : '#f8fafc';
      parts.push(
        renderDataRow(evBg, {
          date: safeText(row.date),
          docNo: safeText(row.documentNo),
          typeLabel: safeText(row.typeLabel),
          fabric: row.fabric,
          debit: row.debit,
          credit: row.credit,
          balance: row.balance,
        }),
      );
    });

    return parts.join('');
  })();

  // ── Render ────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4 portrait; margin: 6mm 5mm 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: Tahoma, "Segoe UI", "Arabic Typesetting", Arial, sans-serif;
    background: #fff;
    color: #0f172a;
    direction: rtl;
    unicode-bidi: isolate;
    min-height: 100%;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ar {
    direction: rtl;
    unicode-bidi: isolate;
    letter-spacing: normal;
    word-spacing: normal;
  }

  .stmt-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 0 2mm 0;
  }
  .stmt-body { flex: 1 1 auto; }

  /* ── Header ─────────────────────────────────────────── */
  .hdr { display: grid; grid-template-columns: 1fr 1.8fr 1fr; gap: 10px; align-items: start; margin-bottom: 10px; }

  .hdr-box {
    border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 10px 12px;
    background: #f8fafc; font-size: 12px;
  }
  .hdr-box-label { font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 5px; display: flex; align-items: center; gap: 5px; }
  .hdr-box-val   { font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
  .hdr-box-sub   { font-size: 11px; color: #475569; margin-top: 2px; }

  .hdr-center { text-align: center; padding: 0; }
  .hdr-center .logo { height: 72px; width: auto; object-fit: contain; display: block; margin: 0 auto 2px; }
  .hdr-center h1 { font-size: 20px; font-weight: 800; color: ${NAVY}; margin: 0; }
  .hdr-center .sub { font-size: 12px; color: #475569; margin-top: 2px; }
  .hdr-center .divider { width: 50px; height: 2px; background: ${NAVY}; margin: 4px auto; border-radius: 2px; }

  /* ── Summary cards ───────────────────────────────────── */
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }

  .card { border-radius: 10px; padding: 10px 12px; border: 1.5px solid; }
  .card-icon { font-size: 16px; margin-bottom: 4px; line-height: 1; }
  .card-label { font-size: 10.5px; font-weight: 600; margin-bottom: 3px; }
  .card-amount { font-size: 14px; font-weight: 800; }

  .card-navy { background: ${NAVY}; border-color: ${NAVY}; color: #fff; }
  .card-navy .card-label  { color: #cbd5e1; }
  .card-navy .card-amount { color: #fff; }

  .card-green { background: #f0fdf4; border-color: ${GREEN}; }
  .card-green .card-label  { color: #166534; }
  .card-green .card-amount { color: ${GREEN}; }

  .card-red { background: #fff5f5; border-color: ${RED}; }
  .card-red .card-label  { color: #991b1b; }
  .card-red .card-amount { color: ${RED}; }

  .card-blue { background: #eff6ff; border-color: ${BLUE}; }
  .card-blue .card-label  { color: #1e40af; }
  .card-blue .card-amount { color: ${BLUE}; }

  /* ── Table ───────────────────────────────────────────── */
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  tbody td { color: #000000; }
  thead tr { background: #e2e8f0; color: #000000; }
  thead th {
    padding: 8px 5px; border: 1px solid #64748b; font-weight: 800;
    font-size: 10px; text-align: center; white-space: nowrap; color: #000000;
  }
  thead th.th-green { color: #14532d; }
  thead th.th-red   { color: #7f1d1d; }
  thead th.th-blue  { color: #1e3a8a; }

  tfoot tr { background: #e2e8f0; color: #000000; }
  tfoot td {
    padding: 8px 5px; border: 1px solid #64748b; font-weight: 800;
    font-size: 10px; text-align: center; color: #000000;
  }
  tfoot td.tf-green { color: #14532d; }
  tfoot td.tf-red   { color: #7f1d1d; }
  tfoot td.tf-blue  { color: #1e3a8a; }

  /* ── Signatures ──────────────────────────────────────── */
  .sigs {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
    margin-top: 14px; margin-bottom: 10px;
  }
  .sig-box {
    border: 1.5px solid #cbd5e1; border-radius: 8px;
    padding: 12px 14px 14px; min-height: 96px;
  }
  .sig-label {
    font-size: 11px; font-weight: 700; color: #1e293b;
    margin-bottom: 8px; display: flex; align-items: center; gap: 5px;
  }
  .sig-row {
    display: flex; align-items: flex-end; gap: 10px;
    margin-top: 12px;
  }
  .sig-row:first-of-type { margin-top: 0; }
  .sig-key {
    flex: 0 0 auto; font-size: 10.5px; font-weight: 600;
    color: #475569; white-space: nowrap; padding-bottom: 5px;
  }
  .sig-write {
    flex: 1 1 auto; min-width: 0;
    border-bottom: 1.5px solid #64748b;
  }
  .sig-write--name { min-height: 20px; margin-bottom: 2px; }
  .sig-write--sign { min-height: 28px; }
  .sig-notes-space { min-height: 58px; margin-top: 4px; }

  ${documentFooterStyles(NAVY)}

  @media print {
    @page { size: A4 portrait; margin: 6mm 5mm 0; }
    html, body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .stmt-page { min-height: auto; padding: 0; }
    .card, .card-navy, .card-green, .card-red, .card-blue,
    thead tr, tfoot tr, tbody td {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    tbody td { color: #000000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th, tfoot td { color: #000000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th.th-green, tfoot td.tf-green { color: #14532d !important; }
    thead th.th-red, tfoot td.tf-red { color: #7f1d1d !important; }
    thead th.th-blue, tfoot td.tf-blue { color: #1e3a8a !important; }
  }
</style>
<body>
<div class="stmt-page">
<div class="stmt-body">

  <!-- ══ HEADER ══════════════════════════════════════════════════ -->
  <div class="hdr">
    <div class="hdr-box">
      <div class="hdr-box-label">&#128197; الفترة</div>
      <div class="hdr-box-val">من: ${safeText(options.fromDate)}</div>
      <div class="hdr-box-val">إلى: ${safeText(options.toDate)}</div>
    </div>

    <div class="hdr-center">
      <img class="logo" src="${BRAND.logoInline}" alt="${BRAND.name}" />
      <h1 class="ar">${safeText(options.title)}</h1>
      <div class="divider"></div>
      <div class="sub ar">(حركات مالية)</div>
    </div>

    <div class="hdr-box">
      <div class="hdr-box-label">&#128100; ${safeText(options.partyLabel)}</div>
      <div class="hdr-box-val">${safeText(options.partyName)}</div>
      <div class="hdr-box-sub">${safeText(phonePart)}</div>
      <div class="hdr-box-sub">${safeText(addressPart)}</div>
    </div>
  </div>

  <!-- ══ SUMMARY CARDS ═══════════════════════════════════════════ -->
  <div class="cards">
    <div class="card card-navy">
      <div class="card-icon">&#128179;</div>
      <div class="card-label">الرصيد الافتتاحي</div>
      <div class="card-amount">${safeText(options.currency)} ${fmt(options.openingBalance)}</div>
    </div>
    <div class="card card-green">
      <div class="card-icon" style="color:${GREEN};">&#8595;</div>
      <div class="card-label">إجمالي المدين</div>
      <div class="card-amount">${safeText(options.currency)} ${fmt(options.totals.debit)}</div>
    </div>
    <div class="card card-red">
      <div class="card-icon" style="color:${RED};">&#8593;</div>
      <div class="card-label">إجمالي الدائن</div>
      <div class="card-amount">${safeText(options.currency)} ${fmt(options.totals.credit)}</div>
    </div>
    <div class="card card-blue">
      <div class="card-icon" style="color:${BLUE};">&#9878;</div>
      <div class="card-label">الرصيد النهائي (${safeText(options.closingLabel)})</div>
      <div class="card-amount">${safeText(options.currency)} ${fmt(options.closingAmount)}</div>
    </div>
  </div>

  <!-- ══ TABLE ════════════════════════════════════════════════════ -->
  <table>
    <colgroup>
      <col style="width:7%">  <!-- التاريخ -->
      <col style="width:8%">  <!-- رقم الفاتورة -->
      <col style="width:9%">  <!-- البيان -->
      <col style="width:9%">  <!-- الخامة -->
      <col style="width:6%">  <!-- عدد -->
      <col style="width:7%">  <!-- إجمالي الأطوال -->
      <col style="width:6%">  <!-- السعر -->
      <col style="width:10%"> <!-- إجمالي المبلغ -->
      <col style="width:9%">  <!-- مدين -->
      <col style="width:9%">  <!-- دائن -->
      <col style="width:10%"> <!-- الرصيد -->
    </colgroup>
    <thead>
      <tr>
        <th>التاريخ</th>
        <th>رقم الفاتورة</th>
        <th>البيان</th>
        <th>الخامة</th>
        <th>عدد<br>الأثواب</th>
        <th>إجمالي<br>الأطوال (م)</th>
        <th>السعر<br>(م)</th>
        <th>إجمالي المبلغ</th>
        <th class="th-green">مدين<br>(${safeText(options.currency)})</th>
        <th class="th-red">دائن<br>(${safeText(options.currency)})</th>
        <th class="th-blue">الرصيد<br>(${safeText(options.currency)})</th>
      </tr>
    </thead>
    <tbody>
      ${bodyHtml}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right;padding-right:10px;">الإجمالي</td>
        <td>${totalFabricRolls > 0 ? totalFabricRolls.toLocaleString('ar') : DASH}</td>
        <td class="tf-green">${fmt(totalFabricLength)}</td>
        <td></td>
        <td class="tf-green">${safeText(options.currency)} ${fmt(totalFabricAmount)}</td>
        <td class="tf-green">${fmt(options.totals.debit)}</td>
        <td class="tf-red">${fmt(options.totals.credit)}</td>
        <td class="tf-blue">${fmt(options.closingAmount)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- ══ SIGNATURES ═══════════════════════════════════════════════ -->
  <div class="sigs">
    <div class="sig-box">
      <div class="sig-label">&#128100; مسؤول الحساب</div>
      <div class="sig-row">
        <span class="sig-key">الاسم:</span>
        <span class="sig-write sig-write--name"></span>
      </div>
      <div class="sig-row">
        <span class="sig-key">التوقيع:</span>
        <span class="sig-write sig-write--sign"></span>
      </div>
    </div>
    <div class="sig-box">
      <div class="sig-label">&#128100; اعتماد الحسابات</div>
      <div class="sig-row">
        <span class="sig-key">الاسم:</span>
        <span class="sig-write sig-write--name"></span>
      </div>
      <div class="sig-row">
        <span class="sig-key">التوقيع:</span>
        <span class="sig-write sig-write--sign"></span>
      </div>
    </div>
    <div class="sig-box">
      <div class="sig-label">&#128203; ملاحظات</div>
      <div class="sig-notes-space"></div>
    </div>
  </div>

  </div>

  ${renderDocumentFooterHtml('invoice', false, {
    slogan: 'شراكتنا لا تُقاس بالأرقام فقط، بل بالثقة التي نبنيها معاً',
  })}

</div>
</body>
</html>`;
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
    title: 'كشف حساب عميل',
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

    const baseName = filenamePrefix.replace(/\.pdf$/i, '');
    pdf.save(`${baseName}.pdf`);
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
    .data-table th,
    .data-table td,
    .meta-card td,
    .financial-table td {
      vertical-align: middle !important;
    }
    .data-table th,
    .data-table .cell,
    .data-table .subtotal-cell {
      padding-top: 7px !important;
      padding-bottom: 7px !important;
    }
    .meta-card td,
    .financial-table td {
      padding-top: 8px !important;
      padding-bottom: 8px !important;
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

    const baseName = filenamePrefix.replace(/\.pdf$/i, '');
    pdf.save(`${baseName}.pdf`);
  } finally {
    cleanupCompatibilityStyle();
    document.body.removeChild(iframe);
  }
}

export const exportToPDF = async (data: ExportData) => {
  const container = createPdfContainer();
  container.innerHTML = renderCustomerStatementPdfHtml(data);

  try {
    await saveContainerAsPDF(container, buildCustomerStatementFileName(data.customerName, data.fromDate, data.toDate));
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
};

export const exportSupplierStatementToPDF = async (data: SupplierStatementExportData) => {
  const container = createPdfContainer();
  container.innerHTML = renderSupplierStatementPdfHtml(data);

  try {
    await saveContainerAsPDF(
      container,
      buildSupplierStatementFileName(data.supplierCompany || data.supplierName, data.fromDate, data.toDate),
    );
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
