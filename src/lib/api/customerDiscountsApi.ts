import { apiFetch } from './client';

export interface CustomerDiscountDto {
  id: string;
  discount_no: string;
  discount_date: string;
  customer_id: string;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd: string;
  amount_usd: string;
  description: string | null;
  notes: string | null;
  status: string;
  journal_entry_id: string | null;
  created_at: string;
  customer_name?: string;
}

export interface CreateCustomerDiscountPayload {
  customerId: string;
  discountDate: string;
  amount: number;
  currencyCode?: string;
  exchangeRateToUsd?: number;
  description?: string | null;
  notes?: string | null;
}

export async function listCustomerDiscounts(params: {
  customerId: string;
  fromDate?: string;
  toDate?: string;
  status?: string;
}): Promise<CustomerDiscountDto[]> {
  const q = new URLSearchParams();
  q.set('customerId', params.customerId);
  if (params.fromDate) q.set('fromDate', params.fromDate);
  if (params.toDate) q.set('toDate', params.toDate);
  if (params.status) q.set('status', params.status);
  const res = await apiFetch<{ ok: boolean; data: CustomerDiscountDto[] }>(`/api/customer-discounts?${q}`);
  return res.data;
}

export async function createCustomerDiscount(
  payload: CreateCustomerDiscountPayload,
): Promise<CustomerDiscountDto> {
  const res = await apiFetch<{ ok: boolean; data: CustomerDiscountDto; message?: string }>(
    '/api/customer-discounts',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}

export async function cancelCustomerDiscount(id: string, reason: string): Promise<CustomerDiscountDto> {
  const res = await apiFetch<{ ok: boolean; data: CustomerDiscountDto; message?: string }>(
    `/api/customer-discounts/${id}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
  return res.data;
}
