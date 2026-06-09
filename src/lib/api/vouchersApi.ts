import { apiFetch } from './client';

export type VoucherType = 'RECEIPT' | 'PAYMENT';
export type VoucherStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface VoucherRow {
  id: string;
  voucher_no: string;
  voucher_type: VoucherType;
  voucher_date: string;
  cashbox_id: string | null;
  cashbox_code?: string | null;
  cashbox_name?: string | null;
  party_type: string | null;
  party_id: string | null;
  party_name: string;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd?: string;
  amount_usd?: string;
  payment_method: string;
  status: VoucherStatus;
  description: string | null;
  reference_document_type?: string | null;
  reference_document_no?: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export async function listVouchers(params: {
  type?: VoucherType;
  status?: VoucherStatus;
  cashboxId?: string;
  partyType?: string;
  partyId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.type) q.set('type', params.type);
  if (params.status) q.set('status', params.status);
  if (params.cashboxId) q.set('cashboxId', params.cashboxId);
  if (params.partyType) q.set('partyType', params.partyType);
  if (params.partyId) q.set('partyId', params.partyId);
  if (params.search) q.set('search', params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: VoucherRow[]; total: number; page: number; pageSize: number }>(
    `/api/vouchers${qs}`,
  );
}

export async function getVoucher(id: string) {
  return apiFetch<{ ok: boolean; data: VoucherRow }>(`/api/vouchers/${id}`);
}

export async function createVoucher(payload: {
  voucherType: VoucherType;
  voucherDate?: string;
  cashboxId?: string | null;
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'OTHER' | null;
  partyId?: string | null;
  partyName: string;
  amount: number;
  currencyCode?: string;
  exchangeRateToUsd?: number;
  amountUsd?: number;
  paymentMethod?: 'CASH' | 'BANK' | 'TRANSFER' | 'OTHER';
  description?: string | null;
  notes?: string | null;
  referenceDocumentType?: string | null;
  referenceDocumentNo?: string | null;
}) {
  return apiFetch<{ ok: boolean; data: VoucherRow }>('/api/vouchers', {
    method: 'POST',
    body: JSON.stringify({
      voucherType: payload.voucherType,
      voucherDate: payload.voucherDate,
      cashboxId: payload.cashboxId ?? null,
      partyType: payload.partyType ?? null,
      partyId: payload.partyId ?? null,
      partyName: payload.partyName,
      amount: payload.amount,
      currencyCode: payload.currencyCode ?? 'USD',
      exchangeRateToUsd: payload.exchangeRateToUsd,
      amountUsd: payload.amountUsd,
      paymentMethod: payload.paymentMethod ?? 'CASH',
      description: payload.description ?? null,
      notes: payload.notes ?? null,
      referenceDocumentType: payload.referenceDocumentType ?? null,
      referenceDocumentNo: payload.referenceDocumentNo ?? null,
    }),
  });
}

export async function confirmVoucher(id: string) {
  return apiFetch<{ ok: boolean; data: { id: string; status: string } }>(`/api/vouchers/${id}/confirm`, {
    method: 'PATCH',
    body: '{}',
  });
}

export async function cancelVoucher(id: string) {
  return apiFetch<{ ok: boolean; data: { id: string; status: string } }>(`/api/vouchers/${id}/cancel`, {
    method: 'PATCH',
    body: '{}',
  });
}
