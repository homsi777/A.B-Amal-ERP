import { apiFetch } from './client';

export type CheckStatus = 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'PAID_OUT';

export interface CheckDto {
  id: string;
  check_no: string;
  bank_name: string;
  account_holder_name: string | null;
  party_type: string | null;
  party_id: string | null;
  party_name: string | null;
  amount: string;
  currency_code: string;
  received_date: string;
  due_date: string;
  image_data: string | null;
  status: CheckStatus;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
}

export type CheckSortBy = 'dueDate' | 'amountDesc' | 'amountAsc' | 'receivedDesc' | 'receivedAsc';

export async function listChecks(params: {
  status?: CheckStatus;
  search?: string;
  dueFrom?: string;
  dueTo?: string;
  sortBy?: CheckSortBy;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.search) q.set('search', params.search);
  if (params.dueFrom) q.set('dueFrom', params.dueFrom);
  if (params.dueTo) q.set('dueTo', params.dueTo);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; rows: CheckDto[]; total: number; page: number; pageSize: number }>(`/api/checks${qs}`);
}

export async function createCheck(payload: {
  checkNo: string;
  bankName: string;
  accountHolderName?: string | null;
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'OTHER' | null;
  partyId?: string | null;
  partyName?: string | null;
  amount: number;
  currencyCode?: string;
  receivedDate?: string | null;
  dueDate: string;
  imageData?: string | null;
}) {
  return apiFetch<{ ok: boolean; data: CheckDto }>('/api/checks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function depositCheck(id: string, bankCashboxId: string, depositDate?: string) {
  return apiFetch<{ ok: boolean; data: CheckDto }>(`/api/checks/${id}/deposit`, {
    method: 'POST',
    body: JSON.stringify({ bankCashboxId, depositDate }),
  });
}

export async function markCheckCleared(id: string) {
  return apiFetch<{ ok: boolean; data: CheckDto }>(`/api/checks/${id}/clear`, {
    method: 'POST',
    body: '{}',
  });
}

export async function returnCheck(id: string, note?: string | null) {
  return apiFetch<{ ok: boolean; data: CheckDto }>(`/api/checks/${id}/return`, {
    method: 'POST',
    body: JSON.stringify({ note: note ?? null }),
  });
}
