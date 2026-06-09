import { apiFetch } from './client';

export type ReturnType = 'SALES_RETURN' | 'PURCHASE_RETURN';
export type ReturnStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
export type SettlementType = 'CREDIT_BALANCE' | 'CASH_REFUND' | 'MIXED' | 'NO_FINANCIAL_EFFECT';

export interface ReturnInvoice {
  id: string;
  return_no: string;
  return_type: ReturnType;
  customer_id: string | null;
  supplier_id: string | null;
  original_invoice_no: string | null;
  original_sales_invoice_id: string | null;
  original_purchase_invoice_id: string | null;
  original_sales_invoice_no?: string | null;
  original_purchase_invoice_no?: string | null;
  settlement_type?: SettlementType;
  reason?: string | null;
  posted_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  return_date: string;
  currency_code: string;
  exchange_rate_to_usd?: string | number;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total_amount: string;
  status: ReturnStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customer_name?: string | null;
  supplier_name?: string | null;
}

export interface ReturnInvoiceLine {
  id: string;
  fabric_roll_id: string | null;
  fabric_item_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  line_total: string;
  notes: string | null;
  original_sales_invoice_line_id?: string | null;
  original_purchase_invoice_line_id?: string | null;
  returned_from_quantity?: string | null;
  return_reason?: string | null;
}

export interface ReturnInvoiceDetail extends ReturnInvoice {
  lines: ReturnInvoiceLine[];
  gl_journal?: { id: string; entry_no: string; entry_date: string; description: string; source_type: string } | null;
}

export interface ReturnLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  unit?: 'meter' | 'yard';
  fabricRollId?: string | null;
  fabricItemId?: string | null;
  originalSalesInvoiceLineId?: string | null;
  originalPurchaseInvoiceLineId?: string | null;
  returnReason?: string | null;
  notes?: string | null;
}

export interface CreateReturnPayload {
  returnType: ReturnType;
  customerId?: string | null;
  supplierId?: string | null;
  originalSalesInvoiceId?: string | null;
  originalPurchaseInvoiceId?: string | null;
  originalInvoiceNo?: string | null;
  returnDate?: string;
  currencyCode?: string;
  exchangeRateToUsd?: number;
  discountTotal?: number;
  taxTotal?: number;
  notes?: string | null;
  reason?: string | null;
  settlementType?: SettlementType;
  lines: ReturnLineInput[];
}

export interface EligibleSalesInvoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string;
  customer_name: string | null;
  currency_code: string;
  total_amount: string;
  paid_amount: string;
  remaining_amount: string;
  document_status: string;
  return_fulfillment_status: string;
  eligible: boolean;
}

export interface EligiblePurchaseInvoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  supplier_id: string;
  supplier_name: string | null;
  currency_code: string;
  total_amount: string;
  paid_amount: string;
  remaining_amount: string;
  document_status: string;
  return_fulfillment_status: string;
  eligible: boolean;
}

export interface SourceInvoiceLineForReturn {
  id: string;
  line_no: number;
  description: string;
  quantity: string;
  unit: string;
  quantity_meters: number;
  unit_price: string;
  line_total: string;
  fabric_roll_id: string | null;
  fabric_item_id: string | null;
  barcode: string | null;
  item_name: string | null;
  internal_code: string | null;
  color_name_ar: string | null;
  returned_meters: number;
  available_meters: number;
}

export interface SourceInvoiceForReturn {
  header: Record<string, unknown>;
  lines: SourceInvoiceLineForReturn[];
}

function buildReturnLineBody(l: ReturnLineInput) {
  return {
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    unit: l.unit ?? 'meter',
    fabricRollId: l.fabricRollId ?? null,
    fabricItemId: l.fabricItemId ?? null,
    originalSalesInvoiceLineId: l.originalSalesInvoiceLineId ?? null,
    originalPurchaseInvoiceLineId: l.originalPurchaseInvoiceLineId ?? null,
    returnReason: l.returnReason ?? null,
    notes: l.notes ?? null,
  };
}

function buildCreateBody(payload: CreateReturnPayload) {
  return {
    returnType: payload.returnType,
    customerId: payload.customerId ?? null,
    supplierId: payload.supplierId ?? null,
    originalSalesInvoiceId: payload.originalSalesInvoiceId ?? null,
    originalPurchaseInvoiceId: payload.originalPurchaseInvoiceId ?? null,
    originalInvoiceNo: payload.originalInvoiceNo ?? null,
    returnDate: payload.returnDate,
    currencyCode: payload.currencyCode ?? 'USD',
    exchangeRateToUsd: payload.exchangeRateToUsd,
    discountTotal: payload.discountTotal ?? 0,
    taxTotal: payload.taxTotal ?? 0,
    notes: payload.notes ?? null,
    reason: payload.reason ?? null,
    settlementType: payload.settlementType ?? 'CREDIT_BALANCE',
    lines: payload.lines.map(buildReturnLineBody),
  };
}

export async function listReturns(params: {
  search?: string;
  type?: ReturnType;
  status?: ReturnStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.type) q.set('type', params.type);
  if (params.status) q.set('status', params.status);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: ReturnInvoice[]; total: number; page: number; pageSize: number }>(
    `/api/returns${qs}`,
  );
}

export async function getReturn(id: string) {
  return apiFetch<{ ok: boolean; data: ReturnInvoiceDetail }>(`/api/returns/${id}`);
}

export async function createReturn(payload: CreateReturnPayload) {
  return apiFetch<{ ok: boolean; data: { id: string; return_no: string; status: string } }>('/api/returns', {
    method: 'POST',
    body: JSON.stringify(buildCreateBody(payload)),
  });
}

export async function updateReturn(id: string, payload: CreateReturnPayload) {
  return apiFetch<{ ok: boolean; data: { id: string; updated: boolean } }>(`/api/returns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(buildCreateBody(payload)),
  });
}

export async function confirmReturn(id: string) {
  return apiFetch<{ ok: boolean; data: { id: string; status: string } }>(`/api/returns/${id}/confirm`, {
    method: 'PATCH',
    body: '{}',
  });
}

export async function cancelReturn(id: string, cancellationReason?: string | null) {
  return apiFetch<{ ok: boolean; data: { id: string; status: string } }>(`/api/returns/${id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({ cancellationReason: cancellationReason ?? null }),
  });
}

export async function listEligibleSalesInvoices(params: {
  search?: string;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.customerId) q.set('customerId', params.customerId);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: EligibleSalesInvoice[]; total: number; page: number; pageSize: number }>(
    `/api/returns/eligible-sales-invoices${qs}`,
  );
}

export async function listEligiblePurchaseInvoices(params: {
  search?: string;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.supplierId) q.set('supplierId', params.supplierId);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: EligiblePurchaseInvoice[]; total: number; page: number; pageSize: number }>(
    `/api/returns/eligible-purchase-invoices${qs}`,
  );
}

export async function getSourceInvoiceForReturn(type: 'sales' | 'purchase', id: string, excludeReturnId?: string | null) {
  const q = excludeReturnId ? `?excludeReturnId=${encodeURIComponent(excludeReturnId)}` : '';
  return apiFetch<{ ok: boolean; data: SourceInvoiceForReturn }>(`/api/returns/source-invoice/${type}/${id}${q}`);
}
