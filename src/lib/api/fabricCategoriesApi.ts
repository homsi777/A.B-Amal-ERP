import { apiFetch } from './client';

export interface ApiCategory {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  is_active: boolean;
  children?: ApiCategory[];
}

export interface CategoryPayload {
  code: string;
  name: string;
  parent_id?: string | null;
}

export async function listCategories(params: { search?: string } = {}): Promise<ApiCategory[]> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean; data: ApiCategory[] }>(`/api/fabric/categories${qs}`);
  return res.data;
}

export async function getCategoryTree(): Promise<ApiCategory[]> {
  const res = await apiFetch<{ ok: boolean; data: ApiCategory[] }>('/api/fabric/categories/tree');
  return res.data;
}

export async function createCategory(payload: CategoryPayload): Promise<ApiCategory> {
  const res = await apiFetch<{ ok: boolean; data: ApiCategory }>('/api/fabric/categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateCategory(id: string, payload: CategoryPayload): Promise<ApiCategory> {
  const res = await apiFetch<{ ok: boolean; data: ApiCategory }>(`/api/fabric/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function toggleCategoryStatus(id: string): Promise<{ id: string; is_active: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; is_active: boolean } }>(
    `/api/fabric/categories/${id}/toggle-status`,
    { method: 'PATCH' },
  );
  return res.data;
}

export interface CategorySyncResult {
  scannedMaterials: number;
  scannedColors: number;
  createdLevel1: number;
  createdLevel2: number;
  createdLevel3: number;
  createdLevel4: number;
  totalCreated: number;
}

export async function syncCategoriesFromMaterials(): Promise<CategorySyncResult> {
  const res = await apiFetch<{ ok: boolean; data: CategorySyncResult }>(
    '/api/fabric/categories/sync-from-materials',
    { method: 'POST' },
  );
  return res.data;
}
