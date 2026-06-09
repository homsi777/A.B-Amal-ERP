import type { Invoice, InvoiceItem } from '../types';

/** عرض في نموذج إنشاء فاتورة جديدة قبل الحفظ — لا يُخزَّن كـ invoice_no. */
export const INVOICE_NUMBER_PENDING_LABEL = 'سيتم توليده عند الحفظ';

/** عرض عندما لا يوجد invoice_no في بيانات القائمة أو التفاصيل. */
export const INVOICE_NUMBER_MISSING_LABEL = 'بدون رقم';

export function normalizeStoredInvoiceNo(value: unknown): string {
  return String(value ?? '').trim();
}

/** رقم مخزَّن للعرض في القوائم والتفاصيل — لا يُستخدم كـ invoice_no في الطلبات. */
export function displayStoredInvoiceNo(value: unknown): string {
  const t = normalizeStoredInvoiceNo(value);
  return t || INVOICE_NUMBER_MISSING_LABEL;
}

function numFromDb(value: unknown): number {
  if (value == null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function optionalNumFromDb(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function isoDate(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringFromMeta(meta: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = meta[key];
    const s = String(value ?? '').trim();
    if (s) return s;
  }
  return fallback;
}

function mapLineToInvoiceItem(l: Record<string, unknown>): InvoiceItem {
  const unit = l.unit === 'yard' ? 'yard' : 'meter';
  const rollId = l.fabric_roll_id != null ? String(l.fabric_roll_id) : undefined;
  const meta = parseMetadata(l.metadata);
  const description = String(l.description ?? '');
  const materialName = stringFromMeta(meta, ['materialName', 'fabricName'], description);
  const rollNo = stringFromMeta(meta, ['rollNo', 'rollNumber']);
  const supplierBarcode = stringFromMeta(meta, ['supplierBarcode', 'barcode']);
  const printBarcode = stringFromMeta(meta, ['printBarcode']);
  return {
    fabricId: rollId || String(l.id ?? ''),
    quantity: numFromDb(l.quantity),
    unitType: unit,
    unitPrice: numFromDb(l.unit_price),
    lineDiscount: numFromDb(l.line_discount),
    total: numFromDb(l.line_total),
    fabricName: materialName,
    materialName,
    designCode: stringFromMeta(meta, ['designCode', 'dsamNumber']),
    rollNumber: rollNo,
    rollNo,
    colorCode: stringFromMeta(meta, ['colorCode']),
    colorName: stringFromMeta(meta, ['colorName']),
    barcode: supplierBarcode,
    supplierBarcode,
    printBarcode,
    rollsCount: optionalNumFromDb(meta.rolls ?? meta.rollsCount),
    weightKg: optionalNumFromDb(meta.weightKg ?? meta.weight),
    weight: optionalNumFromDb(meta.weight ?? meta.weightKg),
    widthCm: optionalNumFromDb(meta.widthCm),
    gsm: optionalNumFromDb(meta.gsm),
    internalRollId: rollId,
    rawQrPayload: stringFromMeta(meta, ['rawQrPayload']) || undefined,
    rawBarcodePayload: stringFromMeta(meta, ['rawBarcodePayload']) || undefined,
    note: stringFromMeta(meta, ['note']) || '',
  };
}

function normalizeDocumentStatus(value: unknown): Invoice['documentStatus'] | undefined {
  const s = String(value ?? '').toUpperCase();
  if (s === 'DRAFT' || s === 'CONFIRMED' || s === 'VOIDED') return s;
  return undefined;
}

function paymentFromHeader(h: Record<string, unknown>): Invoice['status'] {
  return (h.payment_status as Invoice['status']) || 'unpaid';
}

/** تحويل كمية السطر إلى أمتار للعرض في نموذج الفاتورة (النموذج يرسل meter عند الحفظ). */
function lineQuantityToDisplayMeters(line: Record<string, unknown>): number {
  const qty = numFromDb(line.quantity);
  const unit = line.unit === 'yard' ? 'yard' : 'meter';
  if (unit === 'yard') return Math.round(qty * 0.9144 * 1000) / 1000;
  return qty;
}

/** حقول سطر لملء `InvoiceForm` من استجابة GET الفاتورة (بدون `id` المحلي للنموذج). */
export type InvoiceFormLineDraft = {
  materialName: string;
  dsamNumber: string;
  rollNo: string;
  colorCode: string;
  colorName: string;
  length: string;
  widthCm: string;
  gsm: string;
  weight: string;
  price: string;
  note: string;
  supplierBarcode: string;
  printBarcode: string;
  qualityGrade: string;
  internalRollId: string;
  rawQrPayload: string;
  rawBarcodePayload: string;
};

export function buildInvoiceFormLineDraftsFromDbLines(lines: Record<string, unknown>[]): InvoiceFormLineDraft[] {
  return lines.map((l) => {
    const meta = parseMetadata(l.metadata);
    const description = String(l.description ?? '');
    const materialName = stringFromMeta(meta, ['materialName', 'fabricName'], description);
    const rollNo = stringFromMeta(meta, ['rollNo', 'rollNumber']);
    const supplierBarcode = stringFromMeta(meta, ['supplierBarcode', 'barcode']);
    const printBarcode = stringFromMeta(meta, ['printBarcode']);
    const rollId = l.fabric_roll_id != null ? String(l.fabric_roll_id).trim() : '';
    const lengthM = lineQuantityToDisplayMeters(l);
    const priceNum = numFromDb(l.unit_price);
    return {
      materialName,
      dsamNumber: stringFromMeta(meta, ['designCode', 'dsamNumber']),
      rollNo,
      colorCode: stringFromMeta(meta, ['colorCode']),
      colorName: stringFromMeta(meta, ['colorName']),
      length: lengthM > 0 ? String(lengthM) : '',
      widthCm: optionalNumFromDb(meta.widthCm) != null ? String(meta.widthCm) : '',
      gsm: optionalNumFromDb(meta.gsm) != null ? String(meta.gsm) : '',
      weight:
        optionalNumFromDb(meta.weightKg ?? meta.weight) != null
          ? String(optionalNumFromDb(meta.weightKg ?? meta.weight))
          : '',
      price: priceNum > 0 ? String(priceNum) : '',
      note: stringFromMeta(meta, ['note']) || '',
      supplierBarcode,
      printBarcode,
      qualityGrade: stringFromMeta(meta, ['qualityGrade']),
      internalRollId: rollId,
      rawQrPayload: stringFromMeta(meta, ['rawQrPayload']) || '',
      rawBarcodePayload: stringFromMeta(meta, ['rawBarcodePayload']) || '',
    };
  });
}

/** تفاصيل كاملة من GET /api/sales-invoices/:id */
export function mapSalesInvoiceDetailToInvoice(data: {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
}): Invoice {
  const h = data.header;
  const cn = h.customer_name != null ? String(h.customer_name).trim() : '';
  return {
    id: String(h.id),
    date: isoDate(h.invoice_date),
    type: 'sale',
    partyId: String(h.customer_id),
    partyDisplayName: cn || undefined,
    invoiceNumber: displayStoredInvoiceNo(h.invoice_no),
    currency: String(h.currency_code ?? 'USD'),
    exchangeRateToUsd: optionalNumFromDb(h.exchange_rate_to_usd),
    warehouse: h.warehouse_label ? String(h.warehouse_label) : undefined,
    notes: h.notes ? String(h.notes) : undefined,
    subtotal: numFromDb(h.subtotal),
    discountTotal: numFromDb(h.discount_total),
    taxTotal: numFromDb(h.tax_total),
    totalAmount: numFromDb(h.total_amount),
    paidAmount: numFromDb(h.paid_amount),
    remainingAmount: numFromDb(h.remaining_amount),
    subtotalUsd: optionalNumFromDb(h.subtotal_usd),
    discountUsd: optionalNumFromDb(h.discount_total_usd),
    taxUsd: optionalNumFromDb(h.tax_total_usd),
    totalAmountUsd: optionalNumFromDb(h.total_amount_usd),
    paidAmountUsd: optionalNumFromDb(h.paid_amount_usd),
    remainingAmountUsd: optionalNumFromDb(h.remaining_amount_usd),
    status: paymentFromHeader(h),
    paymentStatus: paymentFromHeader(h),
    documentStatus: normalizeDocumentStatus(h.document_status),
    items: data.lines.map(mapLineToInvoiceItem),
  };
}

export function mapPurchaseInvoiceDetailToInvoice(data: {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
}): Invoice {
  const h = data.header;
  const sn = h.supplier_name != null ? String(h.supplier_name).trim() : '';
  return {
    id: String(h.id),
    date: isoDate(h.invoice_date),
    type: 'purchase',
    partyId: String(h.supplier_id),
    partyDisplayName: sn || undefined,
    invoiceNumber: displayStoredInvoiceNo(h.invoice_no),
    currency: String(h.currency_code ?? 'USD'),
    exchangeRateToUsd: optionalNumFromDb(h.exchange_rate_to_usd),
    warehouse: h.warehouse_label ? String(h.warehouse_label) : undefined,
    notes: h.notes ? String(h.notes) : undefined,
    subtotal: numFromDb(h.subtotal),
    discountTotal: numFromDb(h.discount_total),
    taxTotal: numFromDb(h.tax_total),
    totalAmount: numFromDb(h.total_amount),
    paidAmount: numFromDb(h.paid_amount),
    remainingAmount: numFromDb(h.remaining_amount),
    subtotalUsd: optionalNumFromDb(h.subtotal_usd),
    discountUsd: optionalNumFromDb(h.discount_total_usd),
    taxUsd: optionalNumFromDb(h.tax_total_usd),
    totalAmountUsd: optionalNumFromDb(h.total_amount_usd),
    paidAmountUsd: optionalNumFromDb(h.paid_amount_usd),
    remainingAmountUsd: optionalNumFromDb(h.remaining_amount_usd),
    status: paymentFromHeader(h),
    paymentStatus: paymentFromHeader(h),
    documentStatus: normalizeDocumentStatus(h.document_status),
    items: data.lines.map(mapLineToInvoiceItem),
  };
}

export type ListedSaleInvoice = Invoice & { partyLabel?: string };

export function mapSalesListRowToInvoice(row: Record<string, unknown>): ListedSaleInvoice {
  const cn = row.customer_name != null ? String(row.customer_name).trim() : '';
  return {
    id: String(row.id),
    date: isoDate(row.invoice_date),
    type: 'sale',
    partyId: String(row.customer_id),
    partyDisplayName: cn || undefined,
    invoiceNumber: displayStoredInvoiceNo(row.invoice_no),
    currency: String(row.currency_code ?? 'USD'),
    exchangeRateToUsd: optionalNumFromDb(row.exchange_rate_to_usd),
    warehouse: row.warehouse_label ? String(row.warehouse_label) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    totalAmount: numFromDb(row.total_amount),
    paidAmount: numFromDb(row.paid_amount),
    remainingAmount: numFromDb(row.remaining_amount),
    totalAmountUsd: optionalNumFromDb(row.total_amount_usd),
    paidAmountUsd: optionalNumFromDb(row.paid_amount_usd),
    remainingAmountUsd: optionalNumFromDb(row.remaining_amount_usd),
    status: (row.payment_status as Invoice['status']) || 'unpaid',
    paymentStatus: (row.payment_status as Invoice['status']) || 'unpaid',
    documentStatus: normalizeDocumentStatus(row.document_status),
    items: [],
    partyLabel: row.customer_name ? String(row.customer_name) : undefined,
  };
}

export type ListedPurchaseInvoice = Invoice & { partyLabel?: string };

export function mapPurchaseListRowToInvoice(row: Record<string, unknown>): ListedPurchaseInvoice {
  const sn = row.supplier_name != null ? String(row.supplier_name).trim() : '';
  return {
    id: String(row.id),
    date: isoDate(row.invoice_date),
    type: 'purchase',
    partyId: String(row.supplier_id),
    partyDisplayName: sn || undefined,
    invoiceNumber: displayStoredInvoiceNo(row.invoice_no),
    currency: String(row.currency_code ?? 'USD'),
    exchangeRateToUsd: optionalNumFromDb(row.exchange_rate_to_usd),
    warehouse: row.warehouse_label ? String(row.warehouse_label) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    totalAmount: numFromDb(row.total_amount),
    paidAmount: numFromDb(row.paid_amount),
    remainingAmount: numFromDb(row.remaining_amount),
    totalAmountUsd: optionalNumFromDb(row.total_amount_usd),
    paidAmountUsd: optionalNumFromDb(row.paid_amount_usd),
    remainingAmountUsd: optionalNumFromDb(row.remaining_amount_usd),
    status: (row.payment_status as Invoice['status']) || 'unpaid',
    paymentStatus: (row.payment_status as Invoice['status']) || 'unpaid',
    documentStatus: normalizeDocumentStatus(row.document_status),
    items: [],
    partyLabel: row.supplier_name ? String(row.supplier_name) : undefined,
  };
}
