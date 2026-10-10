import i18n from '../../i18n/config';

const t = (key: string) => i18n.t(key, { ns: 'documentFileNames' });

/** Sanitize a segment for Windows/macOS file names. */
export function sanitizeDocumentFilePart(value: unknown, fallback?: string): string {
  return (
    String(value ?? '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || fallback || t('fallback.document')
  );
}

export function buildCustomerStatementFileName(
  customerName: string,
  fromDate: string,
  toDate: string,
): string {
  return `${t('prefix.accountStatement')}_${sanitizeDocumentFilePart(customerName, t('fallback.customer'))}_${sanitizeDocumentFilePart(fromDate)}_${sanitizeDocumentFilePart(toDate)}`;
}

export function buildSupplierStatementFileName(
  supplierName: string,
  fromDate: string,
  toDate: string,
): string {
  return `${t('prefix.supplierAccountStatement')}_${sanitizeDocumentFilePart(supplierName, t('fallback.supplier'))}_${sanitizeDocumentFilePart(fromDate)}_${sanitizeDocumentFilePart(toDate)}`;
}

export function buildInvoiceStatementFileName(partyName: string, invoiceNo: string): string {
  return `${t('prefix.invoiceStatement')}_${sanitizeDocumentFilePart(partyName, t('fallback.party'))}_${sanitizeDocumentFilePart(invoiceNo, t('fallback.invoice'))}`;
}

export function buildVoucherFileName(
  voucherType: 'RECEIPT' | 'PAYMENT' | string,
  partyName: string,
  voucherNo: string,
): string {
  const typeLabel = String(voucherType).toUpperCase() === 'PAYMENT' ? t('voucherType.payment') : t('voucherType.receipt');
  return `${t('prefix.voucher')}_${typeLabel}_${sanitizeDocumentFilePart(partyName, t('fallback.party'))}_${sanitizeDocumentFilePart(voucherNo, t('fallback.voucher'))}`;
}

export function buildCustomerOrderFileName(customerName: string, orderNo: string): string {
  return `${t('prefix.order')}_${sanitizeDocumentFilePart(customerName, t('fallback.customer'))}_${sanitizeDocumentFilePart(orderNo, t('fallback.order'))}`;
}

/** Strip .pdf extension for Electron save dialogs that add it automatically. */
export function pdfFileStem(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '');
}
