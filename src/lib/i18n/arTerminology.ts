/**
 * User-visible Arabic ERP/accounting terminology.
 * Internal enum/API values stay English; map to these strings only at display boundaries.
 */

import type { Invoice } from '../../types';
import i18n from '../../i18n/config';

/** Labels for print / on-screen invoice statement (كشف الفاتورة). */
export const AR_INVOICE_STATEMENT = {
  get printTitle() { return i18n.t('invoiceStatement.printTitle', { ns: 'terminology' }); },
  get printSubtitle() { return i18n.t('invoiceStatement.printSubtitle', { ns: 'terminology' }); },
  get customerSupplier() { return i18n.t('invoiceStatement.customerSupplier', { ns: 'terminology' }); },
  get serialInvoiceNo() { return i18n.t('invoiceStatement.serialInvoiceNo', { ns: 'terminology' }); },
  get date() { return i18n.t('invoiceStatement.date', { ns: 'terminology' }); },
  get currency() { return i18n.t('invoiceStatement.currency', { ns: 'terminology' }); },
  get warehouse() { return i18n.t('invoiceStatement.warehouse', { ns: 'terminology' }); },
  get paymentStatus() { return i18n.t('invoiceStatement.paymentStatus', { ns: 'terminology' }); },
  get saleTerms() { return i18n.t('invoiceStatement.saleTerms', { ns: 'terminology' }); },
  get paidAmount() { return i18n.t('invoiceStatement.paidAmount', { ns: 'terminology' }); },
  get remainingAmount() { return i18n.t('invoiceStatement.remainingAmount', { ns: 'terminology' }); },
  get total() { return i18n.t('invoiceStatement.total', { ns: 'terminology' }); },
  get notes() { return i18n.t('invoiceStatement.notes', { ns: 'terminology' }); },
  get fabricMaterial() { return i18n.t('invoiceStatement.fabricMaterial', { ns: 'terminology' }); },
  get design() { return i18n.t('invoiceStatement.design', { ns: 'terminology' }); },
  get rollNo() { return i18n.t('invoiceStatement.rollNo', { ns: 'terminology' }); },
  get barcode() { return i18n.t('invoiceStatement.barcode', { ns: 'terminology' }); },
  get colorCode() { return i18n.t('invoiceStatement.colorCode', { ns: 'terminology' }); },
  get colorName() { return i18n.t('invoiceStatement.colorName', { ns: 'terminology' }); },
  get meters() { return i18n.t('invoiceStatement.meters', { ns: 'terminology' }); },
  get kg() { return i18n.t('invoiceStatement.kg', { ns: 'terminology' }); },
  get pricePerM() { return i18n.t('invoiceStatement.pricePerM', { ns: 'terminology' }); },
  get subtotalRow() { return i18n.t('invoiceStatement.subtotalRow', { ns: 'terminology' }); },
  get grandTotals() { return i18n.t('invoiceStatement.grandTotals', { ns: 'terminology' }); },
  get invoicePackingSummary() { return i18n.t('invoiceStatement.invoicePackingSummary', { ns: 'terminology' }); },
  get noInvoiceLines() { return i18n.t('invoiceStatement.noInvoiceLines', { ns: 'terminology' }); },
  get preparedBy() { return i18n.t('invoiceStatement.preparedBy', { ns: 'terminology' }); },
  get deliveredBy() { return i18n.t('invoiceStatement.deliveredBy', { ns: 'terminology' }); },
  get receivedBy() { return i18n.t('invoiceStatement.receivedBy', { ns: 'terminology' }); },
  /** يُطبع على كشوف المسودات قبل التأكيد */
  get draftBanner() { return i18n.t('invoiceStatement.draftBanner', { ns: 'terminology' }); },
};

/** Payment progress for display (حالة الدفع) from settled amounts. */
export function arPaymentProgressFromInvoice(inv: { paidAmount: number; totalAmount: number }): string {
  const { paidAmount: p, totalAmount: t } = inv;
  if (t <= 1e-4) return i18n.t('paymentProgress.dash', { ns: 'terminology' });
  if (p >= t - 1e-4) return i18n.t('paymentProgress.paid', { ns: 'terminology' });
  if (p <= 1e-4) return i18n.t('paymentProgress.unpaid', { ns: 'terminology' });
  return i18n.t('paymentProgress.partial', { ns: 'terminology' });
}

/** Sale / settlement terms narrative (شروط البيع). */
export function arSaleTermsFromInvoice(inv: { paidAmount: number; totalAmount: number }): string {
  const t = inv.totalAmount;
  const p = inv.paidAmount;
  if (t <= 0) return i18n.t('saleTerms.dash', { ns: 'terminology' });
  if (p >= t - 1e-4) return i18n.t('saleTerms.cashPaidFull', { ns: 'terminology' });
  if (p <= 1e-4) return i18n.t('saleTerms.credit', { ns: 'terminology' });
  return i18n.t('saleTerms.creditWithPartial', { ns: 'terminology' });
}

export function arCashPartyFallbackLabel(): string {
  return i18n.t('cashPartyFallback', { ns: 'terminology' });
}

/** Maps stored invoice payment state to short Arabic labels (badges, Telegram, etc.). */
export function arInvoicePaymentStatusCode(status: Invoice['status']): string {
  if (status === 'paid') return i18n.t('paymentProgress.paid', { ns: 'terminology' });
  if (status === 'partial') return i18n.t('paymentProgress.partial', { ns: 'terminology' });
  return i18n.t('paymentProgress.unpaid', { ns: 'terminology' });
}

/** نسخة مضغوطة لجداول الفواتير — تمنع التكدس في عمود حالة الدفع */
export function arInvoicePaymentStatusTable(status: Invoice['status']): string {
  if (status === 'paid') return i18n.t('paymentStatusTable.paid', { ns: 'terminology' });
  if (status === 'partial') return i18n.t('paymentStatusTable.partial', { ns: 'terminology' });
  return i18n.t('paymentStatusTable.unpaid', { ns: 'terminology' });
}

/** Document lifecycle status from backend enums (uppercase). */
export function arDocumentStatus(status: string | null | undefined): string {
  if (!status) return i18n.t('documentStatus.dash', { ns: 'terminology' });
  const s = status.toUpperCase();
  if (s === 'DRAFT') return i18n.t('documentStatus.draft', { ns: 'terminology' });
  if (s === 'CONFIRMED') return i18n.t('documentStatus.confirmed', { ns: 'terminology' });
  if (s === 'VOID' || s === 'VOIDED') return i18n.t('documentStatus.voided', { ns: 'terminology' });
  if (s === 'CANCELLED' || s === 'CANCELED') return i18n.t('documentStatus.voided', { ns: 'terminology' });
  if (s === 'ACTIVE') return i18n.t('documentStatus.active', { ns: 'terminology' });
  if (s === 'INACTIVE') return i18n.t('documentStatus.inactive', { ns: 'terminology' });
  if (s === 'COMPLETED') return i18n.t('documentStatus.completed', { ns: 'terminology' });
  if (s === 'PENDING') return i18n.t('documentStatus.pending', { ns: 'terminology' });
  if (s === 'PARTIAL') return i18n.t('documentStatus.partial', { ns: 'terminology' });
  if (s === 'PAID') return i18n.t('documentStatus.paid', { ns: 'terminology' });
  if (s === 'UNPAID') return i18n.t('documentStatus.unpaid', { ns: 'terminology' });
  return status;
}

/**
 * Accounting-only: side of entry (مدين / دائن). Do not use for "آجل" sale terms.
 */
export function arAccountingCreditSide(): string {
  return i18n.t('accounting.creditSide', { ns: 'terminology' });
}

export function arAccountingDebitSide(): string {
  return i18n.t('accounting.debitSide', { ns: 'terminology' });
}
