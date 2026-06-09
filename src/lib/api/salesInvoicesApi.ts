import { apiFetch } from './client';

export interface SalesInvoiceLinePayload {
  fabricRollId?: string | null;
  fabricItemId?: string | null;
  variantId?: string | null;
  warehouseId?: string | null;
  description?: string;
  quantity: number;
  unit: 'meter' | 'yard';
  unitPrice: number;
  lineDiscount?: number;
  lineTax?: number;
  lineTotal: number;
  metadata?: Record<string, unknown> | null;
}

export interface SalesInvoiceCreatePayload {
  invoiceNo: string;
  invoiceDate: string;
  customerId: string;
  warehouseId?: string | null;
  warehouseLabel?: string | null;
  currencyCode?: string;
  exchangeRateToUsd?: number;
  notes?: string | null;
  subtotal: number;
  discountTotal?: number;
  taxTotal?: number;
  totalAmount: number;
  paidAmount?: number;
  remainingAmount: number;
  subtotalUsd?: number;
  discountTotalUsd?: number;
  taxTotalUsd?: number;
  totalAmountUsd?: number;
  paidAmountUsd?: number;
  remainingAmountUsd?: number;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
  lines: SalesInvoiceLinePayload[];
  confirm?: boolean;
  cashboxId?: string | null;
  partyNameForVoucher?: string | null;
}

export interface SalesInvoiceListParams {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  documentStatus?: string;
  page?: number;
  pageSize?: number;
}

export interface SalesInvoiceListResponse {
  ok: boolean;
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listSalesInvoices(params: SalesInvoiceListParams = {}): Promise<SalesInvoiceListResponse> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.customerId) q.set('customerId', params.customerId);
  if (params.documentStatus) q.set('documentStatus', params.documentStatus);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<SalesInvoiceListResponse>(`/api/sales-invoices${qs}`);
}

export async function getSalesInvoice(id: string): Promise<{
  ok: boolean;
  data: { header: Record<string, unknown>; lines: Record<string, unknown>[] };
}> {
  return apiFetch(`/api/sales-invoices/${id}`);
}

export async function createSalesInvoice(
  payload: SalesInvoiceCreatePayload,
): Promise<{ ok: boolean; data: { id: string; invoiceNo: string; documentStatus: string } }> {
  return apiFetch(`/api/sales-invoices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateSalesInvoice(id: string, partial: Partial<SalesInvoiceCreatePayload>): Promise<{ ok: boolean }> {
  return apiFetch(`/api/sales-invoices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(partial),
  });
}

export async function deleteSalesInvoice(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/sales-invoices/${id}`, { method: 'DELETE' });
}

export async function confirmSalesInvoice(
  id: string,
  body?: { cashboxId?: string | null; partyNameForVoucher?: string | null },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/sales-invoices/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

export async function voidSalesInvoice(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/sales-invoices/${id}/void`, { method: 'POST', body: JSON.stringify({}) });
}
