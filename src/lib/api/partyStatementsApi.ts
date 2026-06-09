import { apiFetch } from './client';

export interface PartyStatementRow {
  date: string;
  type: string;
  typeLabel: string;
  documentNo: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  debitOriginal?: number;
  creditOriginal?: number;
  currency: string;
  sourceType: string;
  sourceId: string;
  status: string;
  notes: string | null;
}

export interface PartyStatementParty {
  id: string;
  code?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  telegram_chat_id?: string | null;
  telegram_enabled?: boolean;
  telegram_label?: string | null;
}

export interface PartyStatementData {
  customer?: PartyStatementParty;
  supplier?: PartyStatementParty;
  period: {
    from: string | null;
    to: string | null;
  };
  openingBalance: number;
  rows: PartyStatementRow[];
  totals: {
    debit: number;
    credit: number;
    closingBalance: number;
  };
}

function buildStatementQuery(params: { fromDate?: string; toDate?: string; currency?: string }) {
  const q = new URLSearchParams();
  if (params.fromDate) q.set('fromDate', params.fromDate);
  if (params.toDate) q.set('toDate', params.toDate);
  if (params.currency) q.set('currency', params.currency);
  return q.toString() ? `?${q}` : '';
}

export async function getCustomerStatement(
  customerId: string,
  params: { fromDate?: string; toDate?: string; currency?: string },
) {
  return apiFetch<{ ok: boolean; data: PartyStatementData }>(
    `/api/customers/${customerId}/statement${buildStatementQuery(params)}`,
  );
}

export async function getSupplierStatement(
  supplierId: string,
  params: { fromDate?: string; toDate?: string; currency?: string },
) {
  return apiFetch<{ ok: boolean; data: PartyStatementData }>(
    `/api/suppliers/${supplierId}/statement${buildStatementQuery(params)}`,
  );
}
