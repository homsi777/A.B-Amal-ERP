import { apiFetch } from './client';

export interface ApiSupplier {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  address: string;
  country: string;
  notes: string;
  telegram_chat_id: string | null;
  telegram_enabled: boolean;
  telegram_label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierPayload {
  name: string;
  code?: string;
  phone?: string;
  email?: string;
  address?: string;
  country?: string;
  notes?: string;
  telegramChatId?: string;
  telegramEnabled?: boolean;
  telegramLabel?: string;
}

export interface SuppliersListParams {
  search?: string;
  status?: 'active' | 'inactive';
  country?: string;
  page?: number;
  pageSize?: number;
}

export interface SuppliersListResult {
  data: ApiSupplier[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listSuppliers(params: SuppliersListParams = {}): Promise<SuppliersListResult> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.country) q.set('country', params.country);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<SuppliersListResult & { ok: boolean }>(`/api/suppliers${qs}`);
  return res;
}

export async function getSupplier(id: string): Promise<ApiSupplier> {
  const res = await apiFetch<{ ok: boolean; data: ApiSupplier }>(`/api/suppliers/${id}`);
  return res.data;
}

export async function createSupplier(payload: SupplierPayload): Promise<ApiSupplier> {
  const res = await apiFetch<{ ok: boolean; data: ApiSupplier }>('/api/suppliers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateSupplier(id: string, payload: SupplierPayload): Promise<ApiSupplier> {
  const res = await apiFetch<{ ok: boolean; data: ApiSupplier }>(`/api/suppliers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function toggleSupplierStatus(id: string): Promise<{ id: string; is_active: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; is_active: boolean } }>(
    `/api/suppliers/${id}/toggle-status`,
    { method: 'PATCH' },
  );
  return res.data;
}
