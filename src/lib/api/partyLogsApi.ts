import { apiFetch } from './client';

export interface PartyActivityRow {
  id: string;
  party_type: 'CUSTOMER' | 'SUPPLIER';
  party_id: string | null;
  party_name: string;
  activity_type: string;
  reference_type: string | null;
  reference_id: string | null;
  reference_no: string | null;
  amount: string | null;
  currency_code: string | null;
  description: string;
  activity_at: string;
  created_at: string;
}

export async function listPartyLogs(params: {
  partyType?: 'CUSTOMER' | 'SUPPLIER';
  partyId?: string;
  search?: string;
  activityType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}) {
  const q = new URLSearchParams();
  if (params.partyType) q.set('partyType', params.partyType);
  if (params.partyId) q.set('partyId', params.partyId);
  if (params.search) q.set('search', params.search);
  if (params.activityType) q.set('activityType', params.activityType);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: PartyActivityRow[]; total: number; page: number; pageSize: number }>(
    `/api/party-logs${qs}`,
  );
}
