import { apiFetch } from './client';

export interface ApiFabricVariant {
  id: string;
  variant_code: string;
  item_id: string;
  color_id: string;
  width_cm: number | null;
  gsm: number | null;
  is_active: boolean;
  item_name?: string;
  item_code?: string;
  color_name_ar?: string;
  color_code?: string;
  hex_color?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FabricVariantPayload {
  item_id: string;
  color_id: string;
  variant_code: string;
  width_cm?: number | null;
  gsm?: number | null;
}

export interface FabricVariantsListParams {
  search?: string;
  status?: 'active' | 'inactive';
  itemId?: string;
  colorId?: string;
  widthCm?: number;
  gsm?: number;
  page?: number;
  pageSize?: number;
}

export interface FabricVariantsListResult {
  data: ApiFabricVariant[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listFabricVariants(params: FabricVariantsListParams = {}): Promise<FabricVariantsListResult> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.itemId) q.set('itemId', params.itemId);
  if (params.colorId) q.set('colorId', params.colorId);
  if (params.widthCm !== undefined) q.set('widthCm', String(params.widthCm));
  if (params.gsm !== undefined) q.set('gsm', String(params.gsm));
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<FabricVariantsListResult & { ok: boolean }>(`/api/fabric/variants${qs}`);
  return res;
}

export async function createFabricVariant(payload: FabricVariantPayload): Promise<ApiFabricVariant> {
  const res = await apiFetch<{ ok: boolean; data: ApiFabricVariant }>('/api/fabric/variants', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateFabricVariant(id: string, payload: FabricVariantPayload): Promise<ApiFabricVariant> {
  const res = await apiFetch<{ ok: boolean; data: ApiFabricVariant }>(`/api/fabric/variants/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function toggleFabricVariantStatus(id: string): Promise<{ id: string; is_active: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; is_active: boolean } }>(
    `/api/fabric/variants/${id}/toggle-status`,
    { method: 'PATCH' },
  );
  return res.data;
}
