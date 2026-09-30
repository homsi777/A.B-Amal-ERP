/**
 * User-visible Arabic ERP/accounting terminology.
 * Internal enum/API values stay English; map to these strings only at display boundaries.
 */

import type { Invoice } from '../../types';
import i18n from '../../i18n/config';

/** Labels for print / on-screen invoice statement (كشف الفاتورة). */
export const AR_INVOICE_STATEMENT = {
  printTitle: 'إشعار تسليم تفصيلي',
  printSubtitle: 'كشف الفاتورة',
  customerSupplier: 'العميل / المورد',
  serialInvoiceNo: 'الرقم / رقم الفاتورة',
  date: 'التاريخ',
  currency: 'العملة',
  warehouse: 'المستودع',
  paymentStatus: 'حالة الدفع',
  saleTerms: 'شروط البيع',
  paidAmount: 'المبلغ المدفوع',
  remainingAmount: 'المبلغ المتبقي',
  total: 'الإجمالي',
  notes: 'ملاحظات',
  fabricMaterial: 'القماش / الخامة',
  design: 'التصميم',
  rollNo: 'رقم التوب',
  barcode: 'الباركود',
  colorCode: 'رمز اللون',
  colorName: 'اسم اللون',
  meters: 'الأمتار',
  kg: 'الوزن',
  pricePerM: 'سعر المتر',
  subtotalRow: 'المجموع الفرعي',
  grandTotals: 'الإجمالي العام',
  invoicePackingSummary: 'ملخص الأشعار',
  noInvoiceLines: 'لا توجد بنود في الفاتورة',
  preparedBy: 'أعدّها',
  deliveredBy: 'سلّمها',
  receivedBy: 'استلمها',
  /** يُطبع على كشوف المسودات قبل التأكيد */
  draftBanner: 'مسودة غير مؤكدة',
} as const;

/** Payment progress for display (حالة الدفع) from settled amounts. */
export function arPaymentProgressFromInvoice(inv: { paidAmount: number; totalAmount: number }): string {
  const { paidAmount: p, totalAmount: t } = inv;
  if (t <= 1e-4) return '—';
  if (p >= t - 1e-4) return 'مدفوع';
  if (p <= 1e-4) return 'غير مدفوع';
  return 'مدفوع جزئياً';
}

/** Sale / settlement terms narrative (شروط البيع). */
export function arSaleTermsFromInvoice(inv: { paidAmount: number; totalAmount: number }): string {
  const t = inv.totalAmount;
  const p = inv.paidAmount;
  if (t <= 0) return '—';
  if (p >= t - 1e-4) return 'نقدي / مدفوع بالكامل';
  if (p <= 1e-4) return 'آجل';
  return 'آجل مع دفعة جزئية';
}

export function arCashPartyFallbackLabel(): string {
  return 'عميل / مورد نقدي';
}

/** Maps stored invoice payment state to short Arabic labels (badges, Telegram, etc.). */
export function arInvoicePaymentStatusCode(status: Invoice['status']): string {
  if (status === 'paid') return 'مدفوع';
  if (status === 'partial') return 'مدفوع جزئياً';
  return 'غير مدفوع';
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
  return 'دائن';
}

export function arAccountingDebitSide(): string {
  return 'مدين';
}
