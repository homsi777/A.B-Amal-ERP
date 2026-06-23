/** Sanitize a segment for Windows/macOS file names. */
export function sanitizeDocumentFilePart(value: unknown, fallback = 'مستند'): string {
  return (
    String(value ?? '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || fallback
  );
}

export function buildCustomerStatementFileName(
  customerName: string,
  fromDate: string,
  toDate: string,
): string {
  return `كشف_حساب_${sanitizeDocumentFilePart(customerName, 'عميل')}_${sanitizeDocumentFilePart(fromDate)}_${sanitizeDocumentFilePart(toDate)}`;
}

export function buildSupplierStatementFileName(
  supplierName: string,
  fromDate: string,
  toDate: string,
): string {
  return `كشف_حساب_مورد_${sanitizeDocumentFilePart(supplierName, 'مورد')}_${sanitizeDocumentFilePart(fromDate)}_${sanitizeDocumentFilePart(toDate)}`;
}

export function buildInvoiceStatementFileName(partyName: string, invoiceNo: string): string {
  return `كشف_فاتورة_${sanitizeDocumentFilePart(partyName, 'طرف')}_${sanitizeDocumentFilePart(invoiceNo, 'فاتورة')}`;
}

export function buildVoucherFileName(
  voucherType: 'RECEIPT' | 'PAYMENT' | string,
  partyName: string,
  voucherNo: string,
): string {
  const typeLabel = String(voucherType).toUpperCase() === 'PAYMENT' ? 'صرف' : 'قبض';
  return `سند_${typeLabel}_${sanitizeDocumentFilePart(partyName, 'طرف')}_${sanitizeDocumentFilePart(voucherNo, 'سند')}`;
}

/** Strip .pdf extension for Electron save dialogs that add it automatically. */
export function pdfFileStem(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '');
}
