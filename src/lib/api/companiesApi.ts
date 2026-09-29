import { apiFetch } from './client';

export type ApiCompany = {
  id: string;
  code: string;
  name: string;
  base_currency_code: string;
  is_active: boolean;
  created_at: string;
};

export async function listCompanies(): Promise<ApiCompany[]> {
  const res = await apiFetch<{ ok: boolean; data: ApiCompany[] }>('/api/companies');
  return res.data;
}

export async function createCompany(payload: {
  code: string;
  name: string;
  baseCurrencyCode?: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName?: string;
}): Promise<ApiCompany> {
  const res = await apiFetch<{ ok: boolean; data: ApiCompany }>('/api/companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateCompany(
  id: string,
  payload: { name?: string; code?: string; isActive?: boolean },
): Promise<ApiCompany> {
  const res = await apiFetch<{ ok: boolean; data: ApiCompany }>(`/api/companies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}
