/**
 * User-visible Arabic ERP/accounting terminology.
 * Internal enum/API values stay English; map to these strings only at display boundaries.
 */

import type { Invoice } from '../../types';

/** Labels for print / on-screen invoice statement (كشف الفاتورة). */
export const AR_INVOICE_STATEMENT = {
  printTitle: 'اشعار تسليم مفصل',
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
  invoicePackingSummary: 'ملخص الاشعار',
  noInvoiceLines: 'لا توجد بنود في الفاتورة',
  preparedBy: 'أعدّها',
  deliveredBy: 'سلّمها',
  receivedBy: 'استلمها',
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

/** Document lifecycle status from backend enums (uppercase). */
export function arDocumentStatus(status: string | null | undefined): string {
  if (!status) return '—';
  const s = status.toUpperCase();
  if (s === 'DRAFT') return 'مسودة';
  if (s === 'CONFIRMED') return 'مؤكدة';
  if (s === 'VOID' || s === 'VOIDED') return 'ملغاة';
  if (s === 'CANCELLED' || s === 'CANCELED') return 'ملغاة';
  if (s === 'ACTIVE') return 'فعّال';
  if (s === 'INACTIVE') return 'غير فعّال';
  if (s === 'COMPLETED') return 'مكتمل';
  if (s === 'PENDING') return 'قيد الانتظار';
  if (s === 'PARTIAL') return 'مدفوع جزئياً';
  if (s === 'PAID') return 'مدفوع';
  if (s === 'UNPAID') return 'غير مدفوع';
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

/** Obada wholesale — قسم التسليم والتفنيد */
export const AR_WHOLESALE = {
  deliverySection: 'التسليم',
  deliveryQueue: 'طلبات بانتظار التسليم',
  deliveryFulfillment: 'تنفيذ التسليم',
  tafnid: 'تفنيد',
  tafnidAction: 'تفنيد الأطوال',
  rollUnit: 'توب',
  rollsCount: 'عدد الأتواب',
  rollLength: 'طول التوب',
  supplierRollNo: 'رقم توب المورد',
  systemBarcode: 'باركود النظام',
  warehouseReceipt: 'إيصال مستودع',
  confirmDelivery: 'تأكيد التسليم',
  pendingDelivery: 'بانتظار التسليم',
  inDelivery: 'قيد التسليم',
  fulfilled: 'تم التسليم',
  confirmedSale: 'بيع مؤكد — بانتظار المستودع',
  tafnidSaved: 'تفنيد محفوظ — بانتظار موافقة المدير',
  chinaImport: 'استيراد قائمة تعبئة صينية',
  wholesaleSales: 'بيع جملة (بالتوب)',
} as const;

export type ObadaDeliveryStatus =
  | 'CONFIRMED_SALE'
  | 'IN_DELIVERY'
  | 'TAFNID_SAVED'
  | 'FULFILLED'
  | 'DRAFT';

export function arDeliveryStatus(status: ObadaDeliveryStatus | string | null | undefined): string {
  if (!status) return '—';
  const s = String(status).toUpperCase();
  if (s === 'CONFIRMED_SALE' || s === 'CONFIRMED') return AR_WHOLESALE.confirmedSale;
  if (s === 'IN_DELIVERY' || s === 'PENDING_DELIVERY') return AR_WHOLESALE.pendingDelivery;
  if (s === 'TAFNID_SAVED') return AR_WHOLESALE.tafnidSaved;
  if (s === 'FULFILLED' || s === 'COMPLETED') return AR_WHOLESALE.fulfilled;
  if (s === 'DRAFT') return 'مسودة';
  return status;
}
