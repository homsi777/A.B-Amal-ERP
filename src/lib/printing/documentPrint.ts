import {
  ACCOUNT_STATEMENT_PDF_OPTIONS,
  A4_FIXED_LAYOUT_PDF_OPTIONS,
  A5_VOUCHER_PDF_OPTIONS,
  ELECTRON_A4_EMBEDDED_MARGINS,
  ELECTRON_A5_EMBEDDED_MARGINS,
  isAccountStatementHtml,
  isVoucherA5Html,
  type PdfExportOptions,
} from '../pdfExport';
import { downloadPrintPdf } from '../api/documentPdfApi';

/** CSS snippet — keeps printed output matching PDF background colors. */
export const PRINT_COLOR_EXACT_CSS = `
  html, body, * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
`;

export function isFullHtmlDocument(html: string): boolean {
  const trimmed = html.trimStart();
  return /<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
}

function escapeHtmlTitle(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Open a print window without breaking full HTML documents (styles must stay in <head>). */
export function openDocumentPrintWindow(html: string, title: string): boolean {
  const printWindow = window.open('', '_blank', 'width=980,height=900');
  if (!printWindow) return false;

  const safeTitle = escapeHtmlTitle(title);
  const content = isFullHtmlDocument(html)
    ? (/<title>[^<]*<\/title>/i.test(html)
      ? html.replace(/<title>[^<]*<\/title>/i, `<title>${safeTitle}</title>`)
      : html.replace(/<head([^>]*)>/i, `<head$1><title>${safeTitle}</title>`))
    : `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${safeTitle}</title><style>${PRINT_COLOR_EXACT_CSS}</style></head><body>${html}</body></html>`;

  printWindow.document.open();
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.onload = () => {
    window.setTimeout(() => {
      printWindow.print();
    }, 400);
  };
  return true;
}

export function resolveDocumentPdfOptions(
  html: string,
  opts: {
    fixedPageLayout?: boolean;
    pageSize?: 'A4' | 'A5';
    orientation?: 'portrait' | 'landscape';
  },
): PdfExportOptions {
  if (opts.fixedPageLayout) return A4_FIXED_LAYOUT_PDF_OPTIONS;
  if (isAccountStatementHtml(html)) {
    return {
      ...ACCOUNT_STATEMENT_PDF_OPTIONS,
      orientation: opts.orientation ?? ACCOUNT_STATEMENT_PDF_OPTIONS.orientation,
    };
  }
  if (isVoucherA5Html(html)) {
    return {
      ...A5_VOUCHER_PDF_OPTIONS,
      orientation: opts.orientation ?? A5_VOUCHER_PDF_OPTIONS.orientation,
    };
  }
  if (isFullHtmlDocument(html)) {
    return {
      orientation: opts.orientation ?? 'portrait',
      pageFormat: opts.pageSize === 'A5' ? 'a5' : 'a4',
      containerWidth: opts.pageSize === 'A5' ? '148mm' : '210mm',
      pageMarginMm: 0,
    };
  }
  return {
    orientation: opts.orientation ?? 'portrait',
    pageFormat: opts.pageSize === 'A5' ? 'a5' : 'a4',
    containerWidth: opts.pageSize === 'A5' ? '148mm' : opts.orientation === 'landscape' ? '297mm' : '210mm',
  };
}

/** تصدير PDF = نفس HTML الطباعة عبر Chromium (الخادم أو Electron) */
export async function exportPrintHtmlToPdf(
  html: string,
  filenamePrefix: string,
  _overrides: Partial<PdfExportOptions> = {},
): Promise<void> {
  const fileName = `${filenamePrefix.replace(/\.pdf$/i, '')}.pdf`;
  await downloadPrintPdf(html, fileName);
}

export function resolveElectronPdfMargins(
  fixedPageLayout: boolean,
  pageSize: 'A4' | 'A5' | 'ROLL_LABEL',
  html?: string,
) {
  if (html && isVoucherA5Html(html) && pageSize === 'A5') {
    return { ...ELECTRON_A5_EMBEDDED_MARGINS };
  }
  if (
    pageSize === 'A4'
    && (fixedPageLayout || (html ? isAccountStatementHtml(html) : false))
  ) {
    return { ...ELECTRON_A4_EMBEDDED_MARGINS };
  }
  return undefined;
}
