import { apiFetch } from './client';

export interface ApiCustomer {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  address: string;
  notes: string;
  telegram_chat_id: string | null;
  telegram_enabled: boolean;
  telegram_label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerPayload {
  name: string;
  code?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  telegramChatId?: string;
  telegramEnabled?: boolean;
  telegramLabel?: string;
}

export interface CustomersListParams {
  search?: string;
  status?: 'active' | 'inactive';
  page?: number;
  pageSize?: number;
}

export interface CustomersListResult {
  data: ApiCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listCustomers(params: CustomersListParams = {}): Promise<CustomersListResult> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<CustomersListResult & { ok: boolean }>(`/api/customers${qs}`);
  return res;
}

export async function getCustomer(id: string): Promise<ApiCustomer> {
  const res = await apiFetch<{ ok: boolean; data: ApiCustomer }>(`/api/customers/${id}`);
  return res.data;
}

export async function createCustomer(payload: CustomerPayload): Promise<ApiCustomer> {
  const res = await apiFetch<{ ok: boolean; data: ApiCustomer }>('/api/customers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function importCustomerStatement(payload: {
  fileName: string;
  customerName: string;
  orderDate: string;
  currencyCode: string;
  cashboxId?: string | null;
  saleLines: Array<{
    date: string;
    originalDateValue?: string;
    dateParseSource?: string;
    materialName: string;
    quantity: number;
    rolls: number;
    city: string;
    unitPrice: number;
    total: number;
    note: string;
  }>;
  payments: Array<{ date: string; originalDateValue?: string; dateParseSource?: string; amount: number; kind: 'payment' | 'return'; rawLabel: string }>;
  returnPayments: Array<{ date: string; originalDateValue?: string; dateParseSource?: string; amount: number; kind: 'payment' | 'return'; rawLabel: string }>;
  sheetBalance: number | null;
  computedSalesTotal: number;
  paymentsTotal: number;
  returnsTotal: number;
  computedBalance: number;
  balanceDifference: number;
}) {
  return apiFetch<{
    ok: boolean;
    data: {
      customer: ApiCustomer;
      invoiceNo: string;
      createdInvoice: boolean;
      createdReceipts: number;
      createdCredits: number;
      createdAdjustment: boolean;
      referenceNo: string;
    };
  }>('/api/customers/import-statement', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateCustomer(id: string, payload: CustomerPayload): Promise<ApiCustomer> {
  const res = await apiFetch<{ ok: boolean; data: ApiCustomer }>(`/api/customers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function toggleCustomerStatus(id: string): Promise<{ id: string; is_active: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; is_active: boolean } }>(
    `/api/customers/${id}/toggle-status`,
    { method: 'PATCH' },
  );
  return res.data;
}
