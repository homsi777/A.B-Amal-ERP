import { apiFetch } from './client';

export interface ExpenseCategoryDto {
  id: string;
  code: string;
  name: string;
  gl_account_id: string;
  is_active: boolean;
  sort_order: number;
}

export interface OperatingExpenseDto {
  id: string;
  expense_no: string;
  expense_date: string;
  category_id: string;
  cashbox_id: string;
  beneficiary_name: string | null;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd: string;
  amount_usd: string;
  description: string;
  notes: string | null;
  status: 'CONFIRMED' | 'CANCELLED';
  journal_entry_id: string | null;
  cashbox_movement_id: string | null;
  created_at: string;
  category_name?: string;
  category_code?: string;
  cashbox_name?: string;
  cashbox_code?: string;
}

export async function listExpenseCategories() {
  return apiFetch<{ ok: boolean; data: ExpenseCategoryDto[] }>('/api/expenses/categories');
}

export async function listOperatingExpenses(params: {
  search?: string;
  cashboxId?: string;
  categoryId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.cashboxId) q.set('cashboxId', params.cashboxId);
  if (params.categoryId) q.set('categoryId', params.categoryId);
  if (params.status) q.set('status', params.status);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{
    ok: boolean;
    data: OperatingExpenseDto[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/expenses${qs}`);
}

export async function createOperatingExpense(payload: {
  expenseDate: string;
  categoryId: string;
  cashboxId: string;
  beneficiaryName?: string | null;
  amount: number;
  currencyCode?: string;
  exchangeRateToUsd?: number;
  description: string;
  notes?: string | null;
}) {
  return apiFetch<{ ok: boolean; data: OperatingExpenseDto; message?: string }>('/api/expenses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function cancelOperatingExpense(id: string, reason: string) {
  return apiFetch<{ ok: boolean; data: OperatingExpenseDto; message?: string }>(`/api/expenses/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
