import { apiFetch } from './client';

export type CashboxTransferStatus = 'DRAFT' | 'CONFIRMED' | 'VOID';

export interface CashboxTransferDto {
  id: string;
  transfer_no: string;
  transfer_date: string;
  from_cashbox_id: string;
  to_cashbox_id: string;
  amount: string;
  currency_code: string;
  notes: string | null;
  status: CashboxTransferStatus;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  voided_at: string | null;
  from_cashbox_name: string;
  from_cashbox_code: string;
  to_cashbox_name: string;
  to_cashbox_code: string;
}

export async function listCashboxTransfers(params: { status?: string; page?: number; pageSize?: number } = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: CashboxTransferDto[]; total: number; page: number; pageSize: number }>(
    `/api/cashbox-transfers${qs}`,
  );
}

export async function createCashboxTransfer(payload: {
  transferDate?: string;
  fromCashboxId: string;
  toCashboxId: string;
  amount: number;
  currencyCode?: string;
  notes?: string | null;
}) {
  return apiFetch<{ ok: boolean; data: CashboxTransferDto }>('/api/cashbox-transfers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function confirmCashboxTransfer(id: string) {
  return apiFetch<{ ok: boolean; data: CashboxTransferDto }>(`/api/cashbox-transfers/${id}/confirm`, {
    method: 'POST',
  });
}

export async function voidCashboxTransfer(id: string) {
  return apiFetch<{ ok: boolean; data: CashboxTransferDto }>(`/api/cashbox-transfers/${id}/void`, {
    method: 'POST',
  });
}
