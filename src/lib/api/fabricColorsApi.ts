import { apiFetch } from './client';

export interface ApiFabricColor {
  id: string;
  name_ar: string;
  name_tr: string;
  color_code: string;
  supplier_color_code: string;
  hex_color: string | null;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FabricColorPayload {
  name_ar: string;
  name_tr?: string;
  color_code: string;
  supplier_color_code?: string;
  hex_color?: string;
  notes?: string;
}

export interface FabricColorsListParams {
  search?: string;
  status?: 'active' | 'inactive';
  colorCode?: string;
  supplierColorCode?: string;
  page?: number;
  pageSize?: number;
}

export interface FabricColorsListResult {
  data: ApiFabricColor[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listFabricColors(params: FabricColorsListParams = {}): Promise<FabricColorsListResult> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.colorCode) q.set('colorCode', params.colorCode);
  if (params.supplierColorCode) q.set('supplierColorCode', params.supplierColorCode);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<FabricColorsListResult & { ok: boolean }>(`/api/fabric/colors${qs}`);
  return res;
}

export async function createFabricColor(payload: FabricColorPayload): Promise<ApiFabricColor> {
  const res = await apiFetch<{ ok: boolean; data: ApiFabricColor }>('/api/fabric/colors', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateFabricColor(id: string, payload: FabricColorPayload): Promise<ApiFabricColor> {
  const res = await apiFetch<{ ok: boolean; data: ApiFabricColor }>(`/api/fabric/colors/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function toggleFabricColorStatus(id: string): Promise<{ id: string; is_active: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; is_active: boolean } }>(
    `/api/fabric/colors/${id}/toggle-status`,
    { method: 'PATCH' },
  );
  return res.data;
}
