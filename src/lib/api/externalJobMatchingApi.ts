import { apiFetch } from './client';

export interface OpenDispatchBalance {
  supplier_id: string;
  supplier_name: string;
  fabric_item_id: string;
  item_name: string;
  total_sent_m: string;
  total_matched_m: string;
  remaining_m: string;
  oldest_open_date: string;
}

export interface OpenDispatchLine {
  id: string;
  job_no: string;
  sent_date: string;
  barcode: string;
  sent_length_m: string;
  matched_length_m: string;
  remaining_m: string;
}

export async function listOpenDispatchBalances(): Promise<OpenDispatchBalance[]> {
  const res = await apiFetch<{ ok: boolean; data: OpenDispatchBalance[] }>('/api/external-job-matching');
  return res.data;
}

export async function listOpenDispatchLines(supplierId: string, fabricItemId: string): Promise<OpenDispatchLine[]> {
  const res = await apiFetch<{ ok: boolean; data: OpenDispatchLine[] }>(
    `/api/external-job-matching/${supplierId}/${fabricItemId}/lines`,
  );
  return res.data;
}

export async function approveShortage(payload: {
  supplierId: string;
  fabricItemId: string;
  amountM: number;
  notes?: string | null;
}): Promise<{ approvedM: number }> {
  const res = await apiFetch<{ ok: boolean; data: { approvedM: number } }>('/api/external-job-matching/approve-shortage', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}
