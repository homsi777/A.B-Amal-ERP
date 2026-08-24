import { apiFetch } from './client';

export interface SoldMaterialReportRow {
  id: string;
  material_name: string;
  material_code: string | null;
  customer_name: string;
  quantity: string;
  unit: 'meter' | 'yard';
  meters: string;
  unit_price: string;
  line_total: string;
  currency_code: string;
  invoice_no: string;
  invoice_date: string;
}

export async function listSoldMaterialReport(params: {
  search?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ data: SoldMaterialReportRow[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const suffix = query.toString() ? `?${query}` : '';
  return apiFetch<{ ok: boolean; data: SoldMaterialReportRow[]; total: number; page: number; pageSize: number }>(
    `/api/inventory/rolls/sold-material-report${suffix}`,
  );
}
