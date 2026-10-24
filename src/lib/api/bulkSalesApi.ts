import { apiFetch } from './client';

export interface ApiBulkSale {
  id: string;
  company_id: string;
  customer_id: string;
  invoice_id: string;
  sale_date: string;
  notes: string | null;
  customer_name: string;
  invoice_no: string;
  is_used: boolean;
  created_at: string;
  updated_at: string;
}

export interface BulkSalePayload {
  customerId: string;
  invoiceId: string;
  saleDate: string;
  notes?: string | null;
}

export async function listBulkSales(opts: { onlyUnused?: boolean } = {}): Promise<ApiBulkSale[]> {
  const q = new URLSearchParams();
  if (opts.onlyUnused) q.set('onlyUnused', 'true');
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean; data: ApiBulkSale[] }>(`/api/bulk-sales${qs}`);
  return res.data;
}

export async function createBulkSale(payload: BulkSalePayload): Promise<ApiBulkSale> {
  const res = await apiFetch<{ ok: boolean; data: ApiBulkSale }>('/api/bulk-sales', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateBulkSale(id: string, payload: BulkSalePayload): Promise<ApiBulkSale> {
  const res = await apiFetch<{ ok: boolean; data: ApiBulkSale }>(`/api/bulk-sales/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return res.data;
}
