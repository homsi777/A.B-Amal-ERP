import { apiFetch } from './client';

export type CoaAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface ChartAccountRow {
  id: string;
  code: string;
  parentId: string | null;
  name: string;
  type: CoaAccountType;
  balance: number;
  currency_code: string | null;
  source_note: string | null;
  isPosting?: boolean;
}

export interface JournalLineRow {
  entry_id: string;
  line_no: number;
  voucher_id: string | null;
  date: string;
  reference: string;
  account_id: string;
  account_name: string;
  party_name: string | null;
  description: string | null;
  debit: number;
  credit: number;
  currency_code: string;
  source_type?: string | null;
}

export async function fetchChartOfAccounts() {
  return apiFetch<{ ok: boolean; data: ChartAccountRow[]; meta?: { note?: string } }>('/api/finance/chart-of-accounts');
}

export async function fetchJournalLines(params: { dateFrom?: string; dateTo?: string; search?: string; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.search) q.set('search', params.search);
  if (params.limit != null) q.set('limit', String(params.limit));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: JournalLineRow[]; meta?: { note?: string } }>(`/api/finance/journal${qs}`);
}

export interface GlPostingAccountRow {
  id: string;
  code: string;
  name: string;
  account_type: string;
  system_key: string | null;
}

export async function fetchGlPostingAccounts() {
  return apiFetch<{ ok: boolean; data: GlPostingAccountRow[] }>('/api/finance/gl-accounts');
}

export type ManualJournalLinePayload = {
  glAccountId: string;
  debit: number;
  credit: number;
  currencyCode?: string;
  description?: string | null;
};

export async function postManualJournalEntry(input: { entryDate: string; description: string; lines: ManualJournalLinePayload[] }) {
  return apiFetch<{ ok: boolean; data: { id: string } }>('/api/finance/journal-entries', {
    method: 'POST',
    body: JSON.stringify({
      entryDate: input.entryDate,
      description: input.description,
      lines: input.lines,
    }),
  });
}
