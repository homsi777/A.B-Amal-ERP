import { apiFetch } from './client';
import type { SalesInvoiceLinePayload, SalesInvoiceCreatePayload } from './salesInvoicesApi';

export type PurchaseInvoiceLinePayload = SalesInvoiceLinePayload;

export type PurchaseInvoiceCreatePayload = Omit<SalesInvoiceCreatePayload, 'customerId'> & {
  supplierId: string;
  supplierInvoiceNo?: string | null;
};

export interface PurchaseInvoiceListParams {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  supplierId?: string;
  documentStatus?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchaseInvoiceListResponse {
  ok: boolean;
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listPurchaseInvoices(params: PurchaseInvoiceListParams = {}): Promise<PurchaseInvoiceListResponse> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.supplierId) q.set('supplierId', params.supplierId);
  if (params.documentStatus) q.set('documentStatus', params.documentStatus);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<PurchaseInvoiceListResponse>(`/api/purchase-invoices${qs}`);
}

export async function getPurchaseInvoice(id: string): Promise<{
  ok: boolean;
  data: { header: Record<string, unknown>; lines: Record<string, unknown>[] };
}> {
  return apiFetch(`/api/purchase-invoices/${id}`);
}

export async function createPurchaseInvoice(
  payload: PurchaseInvoiceCreatePayload,
): Promise<{ ok: boolean; data: { id: string; invoiceNo: string; documentStatus: string } }> {
  return apiFetch(`/api/purchase-invoices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updatePurchaseInvoice(
  id: string,
  partial: Partial<PurchaseInvoiceCreatePayload>,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/purchase-invoices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(partial),
  });
}

export async function deletePurchaseInvoice(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/purchase-invoices/${id}`, { method: 'DELETE' });
}

export async function confirmPurchaseInvoice(
  id: string,
  body?: { cashboxId?: string | null; partyNameForVoucher?: string | null },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/purchase-invoices/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

export async function voidPurchaseInvoice(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/purchase-invoices/${id}/void`, { method: 'POST', body: JSON.stringify({}) });
}
