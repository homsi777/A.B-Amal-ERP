import { apiFetch } from './client';

export interface ApiWarehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  address: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WarehousePayload {
  code: string;
  name: string;
  type?: string;
  address?: string;
}

export interface ApiWarehouseLocation {
  id: string;
  code: string;
  name: string;
  warehouse_id: string;
  is_active: boolean;
  created_at: string;
}

export interface LocationPayload {
  code: string;
  name: string;
}

export async function listWarehouses(params: { search?: string; status?: string } = {}): Promise<ApiWarehouse[]> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean; data: ApiWarehouse[] }>(`/api/warehouses${qs}`);
  return res.data;
}

export async function getWarehouse(id: string): Promise<ApiWarehouse> {
  const res = await apiFetch<{ ok: boolean; data: ApiWarehouse }>(`/api/warehouses/${id}`);
  return res.data;
}

export async function createWarehouse(payload: WarehousePayload): Promise<ApiWarehouse> {
  const res = await apiFetch<{ ok: boolean; data: ApiWarehouse }>('/api/warehouses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateWarehouse(id: string, payload: WarehousePayload): Promise<ApiWarehouse> {
  const res = await apiFetch<{ ok: boolean; data: ApiWarehouse }>(`/api/warehouses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function toggleWarehouseStatus(id: string): Promise<{ id: string; is_active: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; is_active: boolean } }>(
    `/api/warehouses/${id}/toggle-status`,
    { method: 'PATCH' },
  );
  return res.data;
}

export async function listLocations(warehouseId: string): Promise<ApiWarehouseLocation[]> {
  const res = await apiFetch<{ ok: boolean; data: ApiWarehouseLocation[] }>(
    `/api/warehouses/${warehouseId}/locations`,
  );
  return res.data;
}

export async function createLocation(warehouseId: string, payload: LocationPayload): Promise<ApiWarehouseLocation> {
  const res = await apiFetch<{ ok: boolean; data: ApiWarehouseLocation }>(
    `/api/warehouses/${warehouseId}/locations`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}

export async function toggleLocationStatus(id: string): Promise<{ id: string; is_active: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; is_active: boolean } }>(
    `/api/warehouse-locations/${id}/toggle-status`,
    { method: 'PATCH' },
  );
  return res.data;
}
