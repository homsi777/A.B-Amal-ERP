import { apiFetch } from './client';

export interface ApiFabricItem {
  id: string;
  internal_code: string;
  supplier_code: string;
  name: string;
  fabric_type: string;
  unit: string;
  notes: string;
  is_active: boolean;
  category_id: string | null;
  supplier_id: string | null;
  category_name?: string;
  supplier_name?: string;
  created_at: string;
  updated_at: string;
}

export interface FabricItemPayload {
  name: string;
  internal_code: string;
  supplier_code?: string;
  fabric_type?: string;
  unit?: string;
  notes?: string;
  category_id?: string | null;
  supplier_id?: string | null;
}

export interface FabricItemsListParams {
  search?: string;
  status?: 'active' | 'inactive';
  categoryId?: string;
  supplierId?: string;
  fabricType?: string;
  page?: number;
  pageSize?: number;
}

export interface FabricItemsListResult {
  data: ApiFabricItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listFabricItems(params: FabricItemsListParams = {}): Promise<FabricItemsListResult> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.categoryId) q.set('categoryId', params.categoryId);
  if (params.supplierId) q.set('supplierId', params.supplierId);
  if (params.fabricType) q.set('fabricType', params.fabricType);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<FabricItemsListResult & { ok: boolean }>(`/api/fabric/items${qs}`);
  return res;
}

export async function createFabricItem(payload: FabricItemPayload): Promise<ApiFabricItem> {
  const res = await apiFetch<{ ok: boolean; data: ApiFabricItem }>('/api/fabric/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateFabricItem(id: string, payload: FabricItemPayload): Promise<ApiFabricItem> {
  const res = await apiFetch<{ ok: boolean; data: ApiFabricItem }>(`/api/fabric/items/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function toggleFabricItemStatus(id: string): Promise<{ id: string; is_active: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; is_active: boolean } }>(
    `/api/fabric/items/${id}/toggle-status`,
    { method: 'PATCH' },
  );
  return res.data;
}
