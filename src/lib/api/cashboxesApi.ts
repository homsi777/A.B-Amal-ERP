import { apiFetch } from './client';

export interface CashboxDto {
  id: string;
  code: string;
  name: string;
  currency_code: string;
  opening_balance: string;
  current_balance: string;
  is_default: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashboxMovementRow {
  id: string;
  movement_no: string;
  cashbox_id?: string;
  cashbox_name?: string;
  movement_type: string;
  direction: string;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd?: string | null;
  amount_usd?: string | null;
  balance_after: string | null;
  source_type: string | null;
  source_no: string | null;
  description: string;
  movement_at: string;
  created_at: string;
}

export async function listCashboxes(params: { active?: boolean; search?: string; currency?: string } = {}) {
  const q = new URLSearchParams();
  if (params.active !== undefined) q.set('active', String(params.active));
  if (params.search) q.set('search', params.search);
  if (params.currency) q.set('currency', params.currency);
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: CashboxDto[] }>(`/api/cashboxes${qs}`);
}

export async function listAllCashboxMovements(params: { page?: number; pageSize?: number } = {}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{
    ok: boolean;
    data: CashboxMovementRow[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/cashboxes/movements/all${qs}`);
}

export async function createCashbox(payload: {
  code: string;
  name: string;
  currencyCode?: string;
  openingBalance?: number;
  isDefault?: boolean;
  notes?: string | null;
}) {
  return apiFetch<{ ok: boolean; data: CashboxDto }>('/api/cashboxes', {
    method: 'POST',
    body: JSON.stringify({
      code: payload.code,
      name: payload.name,
      currencyCode: payload.currencyCode ?? 'USD',
      openingBalance: payload.openingBalance ?? 0,
      isDefault: payload.isDefault ?? false,
      notes: payload.notes ?? null,
    }),
  });
}
